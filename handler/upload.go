package handler

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const maxUploadSize = 10 << 20 // 10 MB

var allowedImageExts = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true,
	".gif": true, ".webp": true,
}

// saveUploadedImage saves a multipart file to ./static/uploads/<subdir>/ and returns the URL path.
func saveUploadedImage(file io.Reader, originalName, subdir string) (string, error) {
	ext := strings.ToLower(filepath.Ext(originalName))
	if !allowedImageExts[ext] {
		return "", fmt.Errorf("допустимые форматы: jpg, png, gif, webp")
	}

	// Validate actual content via magic bytes — extension alone is not trustworthy
	var header [512]byte
	n, err := io.ReadFull(file, header[:])
	if err != nil && err != io.ErrUnexpectedEOF {
		return "", fmt.Errorf("не удалось прочитать файл")
	}
	mime := http.DetectContentType(header[:n])
	if !strings.HasPrefix(mime, "image/") {
		return "", fmt.Errorf("файл не является изображением")
	}
	// Reconstruct reader so the already-read header bytes are not lost
	file = io.MultiReader(bytes.NewReader(header[:n]), file)

	dir := filepath.Join("./static/uploads", subdir)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("internal error")
	}

	b := make([]byte, 8)
	rand.Read(b)
	filename := fmt.Sprintf("%d_%s%s", time.Now().UnixMilli(), hex.EncodeToString(b), ext)
	dest := filepath.Join(dir, filename)

	out, err := os.Create(dest)
	if err != nil {
		return "", fmt.Errorf("internal error")
	}
	defer out.Close()

	if _, err := io.Copy(out, file); err != nil {
		return "", fmt.Errorf("internal error")
	}

	return "/static/uploads/" + subdir + "/" + filename, nil
}

// POST /api/v1/upload/image
func UploadImage(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxUploadSize)

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "файл не получен"})
		return
	}
	defer file.Close()

	url, err := saveUploadedImage(file, header.Filename, "images")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"url": url})
}
