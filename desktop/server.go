package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const appVersion = "1.2.1"

type HotManifest struct {
	UpdatedAt string `json:"updatedAt"`
	Sha256    string `json:"sha256"`
}

type MetaResponse struct {
	AppVersion  string       `json:"appVersion"`
	HotManifest *HotManifest `json:"hotManifest"`
}

type ScanModsFolderResult struct {
	Canceled                 bool     `json:"canceled"`
	FolderPath               string   `json:"folderPath"`
	JarFiles                 []string `json:"jarFiles"`
	HasConnectorFolder       bool     `json:"hasConnectorFolder"`
	HasEmbeddiumSodiumAlias  bool     `json:"hasEmbeddiumSodiumAlias"`
}

type DesktopHandlerOptions struct {
	StatePath    string
	PickFolder   func() (string, error)
	OpenExternal func(rawURL string) error
}

func injectDesktopAPI(html []byte) []byte {
	const snippet = `<script>window.__GO_DESKTOP_API__ = true;</script>`
	if bytes.Contains(html, []byte("__GO_DESKTOP_API__")) {
		return html
	}
	if idx := bytes.Index(bytes.ToLower(html), []byte("</head>")); idx >= 0 {
		out := make([]byte, 0, len(html)+len(snippet)+1)
		out = append(out, html[:idx]...)
		out = append(out, []byte(snippet)...)
		out = append(out, html[idx:]...)
		return out
	}
	return append([]byte(snippet), html...)
}

func scanModsDir(folderPath string) (ScanModsFolderResult, error) {
	entries, err := os.ReadDir(folderPath)
	if err != nil {
		return ScanModsFolderResult{}, err
	}

	jars := make([]string, 0, len(entries))
	hasConnector := false
	hasAlias := false

	for _, entry := range entries {
		name := entry.Name()
		lower := strings.ToLower(name)
		if entry.IsDir() {
			if lower == "connector" {
				hasConnector = true
			}
			continue
		}
		if strings.HasSuffix(lower, ".jar") || strings.HasSuffix(lower, ".jar.disabled") {
			jars = append(jars, name)
			if strings.Contains(lower, "embeddium") || strings.Contains(lower, "sodium") {
				hasAlias = true
			}
		}
	}

	sort.Slice(jars, func(i, j int) bool {
		return strings.ToLower(jars[i]) < strings.ToLower(jars[j])
	})

	return ScanModsFolderResult{
		Canceled:                false,
		FolderPath:              folderPath,
		JarFiles:                jars,
		HasConnectorFolder:      hasConnector,
		HasEmbeddiumSodiumAlias: hasAlias,
	}, nil
}

func validateExternalURL(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || strings.ContainsAny(trimmed, "\r\n\x00") {
		return "", errors.New("invalid URL")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", err
	}
	scheme := strings.ToLower(parsed.Scheme)
	if (scheme != "http" && scheme != "https") || parsed.Host == "" {
		return "", errors.New("unsupported URL scheme")
	}
	return parsed.String(), nil
}

func readEmbeddedManifest(distFS fs.FS) *HotManifest {
	raw, err := fs.ReadFile(distFS, "data/manifest.json")
	if err != nil {
		return nil
	}
	var m HotManifest
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil
	}
	if m.UpdatedAt == "" && m.Sha256 == "" {
		return nil
	}
	return &m
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func newDesktopHandler(distFS fs.FS, opts DesktopHandlerOptions) http.Handler {
	mux := http.NewServeMux()
	fileServer := http.FileServer(http.FS(distFS))

	serveIndex := func(w http.ResponseWriter) {
		raw, err := fs.ReadFile(distFS, "index.html")
		if err != nil {
			http.Error(w, "index.html not found", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(injectDesktopAPI(raw))
	}

	mux.HandleFunc("/api/desktop/meta", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		writeJSON(w, http.StatusOK, MetaResponse{
			AppVersion:  appVersion,
			HotManifest: readEmbeddedManifest(distFS),
		})
	})

	mux.HandleFunc("/api/desktop/check-hot-db", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		m := readEmbeddedManifest(distFS)
		updatedAt := ""
		if m != nil {
			updatedAt = m.UpdatedAt
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"status":    "up-to-date",
			"updatedAt": updatedAt,
			"message":   "Используется встроенная база сборки",
		})
	})

	mux.HandleFunc("/api/desktop/scan-mods", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if opts.PickFolder == nil {
			writeJSON(w, http.StatusOK, ScanModsFolderResult{
				Canceled: true,
				JarFiles: []string{},
			})
			return
		}
		folder, err := opts.PickFolder()
		folder = strings.TrimSpace(folder)
		if err != nil || folder == "" {
			writeJSON(w, http.StatusOK, ScanModsFolderResult{
				Canceled: true,
				JarFiles: []string{},
			})
			return
		}
		res, err := scanModsDir(folder)
		if err != nil {
			writeJSON(w, http.StatusOK, ScanModsFolderResult{
				Canceled:   true,
				FolderPath: folder,
				JarFiles:   []string{},
			})
			return
		}
		writeJSON(w, http.StatusOK, res)
	})

	mux.HandleFunc("/api/desktop/state", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			if opts.StatePath == "" {
				writeJSON(w, http.StatusOK, nil)
				return
			}
			raw, err := os.ReadFile(opts.StatePath)
			if err != nil || !json.Valid(raw) {
				writeJSON(w, http.StatusOK, nil)
				return
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			_, _ = w.Write(raw)

		case http.MethodPost:
			if opts.StatePath == "" {
				writeJSON(w, http.StatusOK, map[string]bool{"ok": false})
				return
			}
			body, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
			if err != nil || !json.Valid(bytes.TrimSpace(body)) {
				writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid json"})
				return
			}
			if err := os.MkdirAll(filepath.Dir(opts.StatePath), 0o755); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false})
				return
			}
			tmpPath := opts.StatePath + ".tmp"
			if err := os.WriteFile(tmpPath, body, 0o600); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false})
				return
			}
			if err := os.Rename(tmpPath, opts.StatePath); err != nil {
				_ = os.Remove(tmpPath)
				writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false})
				return
			}
			writeJSON(w, http.StatusOK, map[string]bool{"ok": true})

		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/desktop/open-external", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			URL string `json:"url"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]bool{"ok": false})
			return
		}
		safeURL, err := validateExternalURL(req.URL)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]bool{"ok": false})
			return
		}
		if opts.OpenExternal != nil {
			_ = opts.OpenExternal(safeURL)
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		cleanPath := strings.TrimPrefix(filepath.ToSlash(filepath.Clean(r.URL.Path)), "/")
		if cleanPath == "" || cleanPath == "." || cleanPath == "index.html" {
			serveIndex(w)
			return
		}
		if strings.HasPrefix(cleanPath, "api/") {
			http.NotFound(w, r)
			return
		}
		if info, err := fs.Stat(distFS, cleanPath); err == nil && !info.IsDir() {
			applyExplicitWebMimeType(w, cleanPath)
			fileServer.ServeHTTP(w, r)
			return
		}
		serveIndex(w)
	})

	return mux
}

func applyExplicitWebMimeType(w http.ResponseWriter, cleanPath string) {
	switch strings.ToLower(filepath.Ext(cleanPath)) {
	case ".js", ".mjs":
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	case ".css":
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
	case ".json":
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
	case ".html", ".htm":
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
	case ".svg":
		w.Header().Set("Content-Type", "image/svg+xml")
	case ".png":
		w.Header().Set("Content-Type", "image/png")
	case ".jpg", ".jpeg":
		w.Header().Set("Content-Type", "image/jpeg")
	case ".webp":
		w.Header().Set("Content-Type", "image/webp")
	case ".ico":
		w.Header().Set("Content-Type", "image/x-icon")
	case ".wasm":
		w.Header().Set("Content-Type", "application/wasm")
	case ".woff2":
		w.Header().Set("Content-Type", "font/woff2")
	}
}
