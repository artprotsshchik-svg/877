//go:build windows

package main

import (
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	webview2 "github.com/jchv/go-webview2"
)

func resolveAppDataDir() string {
	base, err := os.UserConfigDir()
	if err != nil || strings.TrimSpace(base) == "" {
		home, _ := os.UserHomeDir()
		base = filepath.Join(home, "AppData", "Roaming")
	}
	dir := filepath.Join(base, "ModOptimizerForge1201")
	_ = os.MkdirAll(dir, 0o755)
	return dir
}

func defaultMinecraftModsDir() string {
	appData := os.Getenv("APPDATA")
	if appData != "" {
		mods := filepath.Join(appData, ".minecraft", "mods")
		if info, err := os.Stat(mods); err == nil && info.IsDir() {
			return mods
		}
		mc := filepath.Join(appData, ".minecraft")
		if info, err := os.Stat(mc); err == nil && info.IsDir() {
			return mc
		}
	}
	home, _ := os.UserHomeDir()
	return home
}

func pickModsFolderWindows() (string, error) {
	initial := strings.ReplaceAll(defaultMinecraftModsDir(), "'", "''")
	script := fmt.Sprintf(`
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = 'Выберите папку mods сборки Minecraft Forge 1.20.1'
$dlg.ShowNewFolderButton = $false
if (Test-Path '%s') { $dlg.SelectedPath = '%s' }
$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$res = $dlg.ShowDialog($form)
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dlg.SelectedPath
}
`, initial, initial)

	cmd := exec.Command("powershell.exe", "-NoProfile", "-Sta", "-NonInteractive", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func openExternalWindows(rawURL string) error {
	cmd := exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", rawURL)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Start()
}

func launchBrowserAppFallback(appURL string) error {
	candidates := []string{
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(os.Getenv("ProgramFiles"), "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(os.Getenv("ProgramFiles"), "Google", "Chrome", "Application", "chrome.exe"),
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "Google", "Chrome", "Application", "chrome.exe"),
	}
	for _, bin := range candidates {
		if bin == "" {
			continue
		}
		if _, err := os.Stat(bin); err == nil {
			cmd := exec.Command(bin, "--app="+appURL, "--window-size=1360,880")
			if err := cmd.Start(); err == nil {
				_ = cmd.Wait()
				return nil
			}
		}
	}
	return openExternalWindows(appURL)
}

func main() {
	distFS, err := fs.Sub(webDistFS, "webdist")
	if err != nil {
		panic(err)
	}

	appDir := resolveAppDataDir()
	handler := newDesktopHandler(distFS, DesktopHandlerOptions{
		StatePath:    filepath.Join(appDir, "state.json"),
		PickFolder:   pickModsFolderWindows,
		OpenExternal: openExternalWindows,
	})

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		panic(err)
	}
	srv := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		_ = srv.Serve(listener)
	}()
	defer srv.Close()

	appURL := "http://" + listener.Addr().String() + "/"

	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		DataPath:  filepath.Join(appDir, "webview2"),
		WindowOptions: webview2.WindowOptions{
			Title:  "Mod Optimizer — Forge 1.20.1",
			Width:  1360,
			Height: 880,
			IconId: 1,
			Center: true,
		},
	})
	if w == nil {
		_ = launchBrowserAppFallback(appURL)
		return
	}
	defer w.Destroy()

	w.Init("window.__GO_DESKTOP_API__ = true;")
	w.Navigate(appURL)
	w.Run()
}
