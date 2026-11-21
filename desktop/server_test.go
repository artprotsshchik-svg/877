package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

func makeTestDistFS() fstest.MapFS {
	return fstest.MapFS{
		"index.html": {
			Data: []byte(`<!doctype html><html><head><title>Mod Optimizer</title></head><body><div id="root"></div></body></html>`),
		},
		"data/manifest.json": {
			Data: []byte(`{"updatedAt":"16.11.2026","sha256":"abc123"}`),
		},
		"assets/app.js": {
			Data: []byte(`console.log("ok");`),
		},
	}
}

func TestIndexInjectsDesktopFlagAndServesMeta(t *testing.T) {
	h := newDesktopHandler(makeTestDistFS(), DesktopHandlerOptions{})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "window.__GO_DESKTOP_API__ = true;") {
		t.Fatalf("expected desktop flag script injected into index.html")
	}

	metaReq := httptest.NewRequest(http.MethodGet, "/api/desktop/meta", nil)
	metaRec := httptest.NewRecorder()
	h.ServeHTTP(metaRec, metaReq)

	if metaRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for meta, got %d", metaRec.Code)
	}
	var meta MetaResponse
	if err := json.Unmarshal(metaRec.Body.Bytes(), &meta); err != nil {
		t.Fatalf("invalid meta json: %v", err)
	}
	if meta.HotManifest == nil || meta.HotManifest.UpdatedAt != "16.11.2026" {
		t.Fatalf("unexpected manifest: %+v", meta.HotManifest)
	}

	jsReq := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	jsRec := httptest.NewRecorder()
	h.ServeHTTP(jsRec, jsReq)
	if jsRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for /assets/app.js, got %d", jsRec.Code)
	}
	if ct := jsRec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/javascript") {
		t.Fatalf("expected application/javascript MIME type, got %q", ct)
	}

	jsonReq := httptest.NewRequest(http.MethodGet, "/data/manifest.json", nil)
	jsonRec := httptest.NewRecorder()
	h.ServeHTTP(jsonRec, jsonReq)
	if ct := jsonRec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("expected application/json MIME type, got %q", ct)
	}
}

func TestScanModsEndpointAndConnectorDetection(t *testing.T) {
	tmpDir := t.TempDir()
	modsDir := filepath.Join(tmpDir, "mods")
	if err := os.MkdirAll(filepath.Join(modsDir, "connector"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"embeddium-0.3.31.jar", "ferritecore-6.0.1.jar", "README.txt"} {
		if err := os.WriteFile(filepath.Join(modsDir, f), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	h := newDesktopHandler(makeTestDistFS(), DesktopHandlerOptions{
		PickFolder: func() (string, error) { return modsDir, nil },
	})

	req := httptest.NewRequest(http.MethodPost, "/api/desktop/scan-mods", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	var res ScanModsFolderResult
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.Canceled {
		t.Fatalf("expected non-canceled scan result")
	}
	if !res.HasConnectorFolder || !res.HasEmbeddiumSodiumAlias {
		t.Fatalf("expected connector and embeddium alias detection, got %+v", res)
	}
	if len(res.JarFiles) != 2 {
		t.Fatalf("expected 2 jars, got %v", res.JarFiles)
	}
}

func TestStateRoundtripAndExternalURLValidation(t *testing.T) {
	stateFile := filepath.Join(t.TempDir(), "nested", "state.json")
	var opened []string
	h := newDesktopHandler(makeTestDistFS(), DesktopHandlerOptions{
		StatePath: stateFile,
		OpenExternal: func(rawURL string) error {
			opened = append(opened, rawURL)
			return nil
		},
	})

	payload := []byte(`{"activeTab":"checker","checkedModIds":["embeddium"]}`)
	postReq := httptest.NewRequest(http.MethodPost, "/api/desktop/state", bytes.NewReader(payload))
	postRec := httptest.NewRecorder()
	h.ServeHTTP(postRec, postReq)
	if postRec.Code != http.StatusOK {
		t.Fatalf("expected 200 saving state, got %d", postRec.Code)
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/desktop/state", nil)
	getRec := httptest.NewRecorder()
	h.ServeHTTP(getRec, getReq)
	if !strings.Contains(getRec.Body.String(), `"checkedModIds":["embeddium"]`) {
		t.Fatalf("unexpected persisted state: %s", getRec.Body.String())
	}

	badExt := httptest.NewRequest(http.MethodPost, "/api/desktop/open-external", strings.NewReader(`{"url":"file:///C:/Windows/calc.exe"}`))
	badRec := httptest.NewRecorder()
	h.ServeHTTP(badRec, badExt)
	if badRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for non-http URL, got %d", badRec.Code)
	}

	okExt := httptest.NewRequest(http.MethodPost, "/api/desktop/open-external", strings.NewReader(`{"url":"https://modrinth.com/mod/embeddium"}`))
	okRec := httptest.NewRecorder()
	h.ServeHTTP(okRec, okExt)
	if okRec.Code != http.StatusOK || len(opened) != 1 {
		t.Fatalf("expected valid https URL to open cleanly")
	}
}
