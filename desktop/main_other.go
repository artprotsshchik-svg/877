//go:build !windows

package main

import (
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
)

func main() {
	distFS, err := fs.Sub(webDistFS, "webdist")
	if err != nil {
		panic(err)
	}
	handler := newDesktopHandler(distFS, DesktopHandlerOptions{
		StatePath: filepath.Join(os.TempDir(), "modoptimizer-state.json"),
	})
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		panic(err)
	}
	fmt.Println("Listening on http://" + listener.Addr().String())
	_ = http.Serve(listener, handler)
}
