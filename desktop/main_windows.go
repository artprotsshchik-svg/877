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
	"runtime"
	"strings"
	"syscall"
	"time"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
)

var (
	user32DLL         = syscall.NewLazyDLL("user32.dll")
	procMessageBoxW   = user32DLL.NewProc("MessageBoxW")
	procFindWindowW   = user32DLL.NewProc("FindWindowW")
	procDestroyWindow = user32DLL.NewProc("DestroyWindow")
)

const (
	mbOK              = 0x00000000
	mbIconError       = 0x00000010
	mbIconInformation = 0x00000040
)

func showNativeMessageBox(title, text string, flags uint32) {
	tPtr, _ := syscall.UTF16PtrFromString(title)
	mPtr, _ := syscall.UTF16PtrFromString(text)
	_, _, _ = procMessageBoxW.Call(
		0,
		uintptr(unsafe.Pointer(mPtr)),
		uintptr(unsafe.Pointer(tPtr)),
		uintptr(flags),
	)
}

func destroyOrphanWebviewWindow(title string) {
	classPtr, _ := syscall.UTF16PtrFromString("webview")
	titlePtr, _ := syscall.UTF16PtrFromString(title)
	hwnd, _, _ := procFindWindowW.Call(uintptr(unsafe.Pointer(classPtr)), uintptr(unsafe.Pointer(titlePtr)))
	if hwnd != 0 {
		_, _, _ = procDestroyWindow.Call(hwnd)
	}
}

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

func launchBrowserAppFallback(appURL, appDir string) {
	localAppData := os.Getenv("LOCALAPPDATA")
	programFiles := os.Getenv("ProgramFiles")
	programFilesX86 := os.Getenv("ProgramFiles(x86)")

	candidates := []string{
		filepath.Join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
		filepath.Join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
		filepath.Join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
	}

	profileDir := filepath.Join(appDir, "browser-app")
	_ = os.MkdirAll(profileDir, 0o755)

	for _, bin := range candidates {
		if strings.TrimSpace(bin) == "" || !strings.HasSuffix(strings.ToLower(bin), ".exe") {
			continue
		}
		if _, err := os.Stat(bin); err != nil {
			continue
		}
		startedAt := time.Now()
		cmd := exec.Command(
			bin,
			"--user-data-dir="+profileDir,
			"--no-first-run",
			"--no-default-browser-check",
			"--new-window",
			"--app="+appURL,
			"--window-size=1360,880",
		)
		if err := cmd.Start(); err == nil {
			_ = cmd.Wait()
			// If the browser held the process until window close, exit cleanly.
			if time.Since(startedAt) >= 2*time.Second {
				return
			}
			// If Edge/Chrome delegated to an already running instance and exited immediately,
			// keep local HTTP server alive until user closes the session dialog.
			showNativeMessageBox(
				"Mod Optimizer — Forge 1.20.1",
				fmt.Sprintf("Приложение открыто в окне браузера (%s).\nНе закрывайте это диалоговое окно во время работы — нажмите ОК для завершения.", appURL),
				mbOK|mbIconInformation,
			)
			return
		}
	}

	if err := openExternalWindows(appURL); err != nil {
		showNativeMessageBox(
			"Ошибка запуска Mod Optimizer",
			fmt.Sprintf("Не удалось открыть WebView2 или браузер по адресу %s:\n%v", appURL, err),
			mbOK|mbIconError,
		)
		return
	}
	showNativeMessageBox(
		"Mod Optimizer — Forge 1.20.1",
		fmt.Sprintf("Приложение запущено в браузере (%s).\nНажмите ОК, когда закончите работу с программой.", appURL),
		mbOK|mbIconInformation,
	)
}

func main() {
	runtime.LockOSThread()

	distFS, err := fs.Sub(webDistFS, "webdist")
	if err != nil {
		showNativeMessageBox("Ошибка ресурсов Mod Optimizer", err.Error(), mbOK|mbIconError)
		os.Exit(1)
	}

	appDir := resolveAppDataDir()
	handler := newDesktopHandler(distFS, DesktopHandlerOptions{
		StatePath:    filepath.Join(appDir, "state.json"),
		PickFolder:   pickModsFolderWindows,
		OpenExternal: openExternalWindows,
	})

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		showNativeMessageBox("Ошибка локального сервера Mod Optimizer", err.Error(), mbOK|mbIconError)
		os.Exit(1)
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
	webviewDataDir := filepath.Join(appDir, "webview2")
	_ = os.MkdirAll(webviewDataDir, 0o755)

	const windowTitle = "Mod Optimizer — Forge 1.20.1"
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		DataPath:  webviewDataDir,
		WindowOptions: webview2.WindowOptions{
			Title:  windowTitle,
			Width:  1360,
			Height: 880,
			IconId: 1,
			Center: true,
		},
	})
	if w == nil {
		destroyOrphanWebviewWindow(windowTitle)
		launchBrowserAppFallback(appURL, appDir)
		return
	}
	defer w.Destroy()

	w.Init("window.__GO_DESKTOP_API__ = true;")
	w.Navigate(appURL)
	w.Run()
}
