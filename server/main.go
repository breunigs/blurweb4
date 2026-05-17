package main

import (
	"bytes"
	"compress/gzip"
	"embed"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"os/exec"
	"path"
	"runtime"
	"strings"
)

//go:embed dist-embedded
var embeddedFS embed.FS

func main() {
	subFS, err := fs.Sub(embeddedFS, "dist-embedded")
	if err != nil {
		panic(err)
	}

	const preferredPort = 49539
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", preferredPort))
	if err != nil {
		// Port in use — fall back to a random port (cache/IDB won't persist across runs).
		listener, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			panic(err)
		}
		fmt.Printf("Note: port %d is in use; using random port — browser storage won't persist across sessions.\n", preferredPort)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	url := fmt.Sprintf("http://localhost:%d", port)

	fmt.Printf("BlurWeb running at %s\n", url)
	go openBrowser(url)

	if err := http.Serve(listener, makeHandler(subFS)); err != nil {
		panic(err)
	}
}

func makeHandler(files fs.FS) http.Handler {
	mime.AddExtensionType(".mjs", "text/javascript")
	mime.AddExtensionType(".wasm", "application/wasm")
	mime.AddExtensionType(".css", "text/css; charset=utf-8")
	mime.AddExtensionType(".js", "text/javascript")
	mime.AddExtensionType(".html", "text/html; charset=utf-8")
	mime.AddExtensionType(".json", "application/json")
	mime.AddExtensionType(".svg", "image/svg+xml")

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if p == "" || p == "." {
			p = "index.html"
		}

		data, err := fs.ReadFile(files, p+".gz")
		if err != nil {
			http.NotFound(w, r)
			return
		}

		ext := path.Ext(p) // use original extension for MIME, not ".gz"
		ct := mime.TypeByExtension(ext)
		if ct == "" {
			ct = "application/octet-stream"
		}
		w.Header().Set("Content-Type", ct)

		if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			w.Header().Set("Content-Encoding", "gzip")
			w.WriteHeader(http.StatusOK)
			w.Write(data) //nolint:errcheck
			return
		}

		// Decompress for clients that don't advertise gzip support.
		gz, err := gzip.NewReader(bytes.NewReader(data))
		if err != nil {
			http.Error(w, "decompression error", http.StatusInternalServerError)
			return
		}
		defer gz.Close()
		w.WriteHeader(http.StatusOK)
		io.Copy(w, gz) //nolint:errcheck
	})
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	cmd.Start() //nolint:errcheck
}
