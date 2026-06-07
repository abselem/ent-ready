package handler

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/ledongthuc/pdf"
)

// ── Structs returned to frontend ─────────────────────────────────────────────

type ImportOption struct {
	Label string `json:"label"` // A, B, C…
	Text  string `json:"text"`
}

type ImportQuestion struct {
	Num       int            `json:"num"`
	Text      string         `json:"text"`
	Options   []ImportOption `json:"options"`
	Type      string         `json:"type"` // single | multi | matching | context
	ContextID *int           `json:"context_id,omitempty"`
	ImageURL  string         `json:"image_url,omitempty"`
}

type ImportContext struct {
	ID    int    `json:"id"`
	Title string `json:"title"`
	Body  string `json:"body"`
}

type ImportResult struct {
	Questions []ImportQuestion `json:"questions"`
	Contexts  []ImportContext  `json:"contexts"`
}

// ── Handler ───────────────────────────────────────────────────────────────────

// POST /questions/parse-text — parse plain text into questions (used when frontend extracts PDF text)
func ParseQuestionsFromText(c *gin.Context) {
	var body struct {
		Text string `json:"text" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	result := parseImportedText(body.Text)
	c.JSON(http.StatusOK, result)
}

func ImportQuestionsFromFile(c *gin.Context) {
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "файл обязателен"})
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка чтения файла"})
		return
	}

	ext := strings.ToLower(filepath.Ext(header.Filename))
	var text string

	switch ext {
	case ".pdf":
		text, err = extractPDFText(data)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "не удалось прочитать PDF: " + err.Error()})
			return
		}
	case ".docx":
		text, err = extractDOCXText(data)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "не удалось прочитать DOCX: " + err.Error()})
			return
		}
	case ".txt":
		text = string(data)
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "поддерживаются форматы: DOCX, PDF, TXT"})
		return
	}

	result := parseImportedText(text)
	c.JSON(http.StatusOK, result)
}

// ── PDF text extraction ───────────────────────────────────────────────────────

func extractPDFText(data []byte) (string, error) {
	r, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", err
	}

	var sb strings.Builder
	for i := 1; i <= r.NumPage(); i++ {
		p := r.Page(i)
		if p.V.IsNull() {
			continue
		}
		// Collect text items with position-aware line reconstruction
		content := p.Content()
		if len(content.Text) == 0 {
			continue
		}

		// Group text items by approximate Y coordinate (same line)
		type textItem struct {
			x, y float64
			s    string
		}
		items := make([]textItem, 0, len(content.Text))
		for _, t := range content.Text {
			s := strings.TrimSpace(t.S)
			if s != "" {
				items = append(items, textItem{t.X, t.Y, s})
			}
		}

		// Sort by Y descending (top of page first), then X ascending
		for i := 1; i < len(items); i++ {
			for j := i; j > 0; j-- {
				a, b := items[j-1], items[j]
				if a.y-b.y < -2 || (abs64(a.y-b.y) <= 2 && a.x > b.x) {
					items[j-1], items[j] = items[j], items[j-1]
				}
			}
		}

		prevY := items[0].y
		prevX := 0.0
		for _, it := range items {
			if abs64(it.y-prevY) > 4 {
				sb.WriteString("\n")
				prevY = it.y
				prevX = 0
			} else if it.x-prevX > 8 {
				sb.WriteString(" ")
			}
			sb.WriteString(it.s)
			prevX = it.x + float64(len(it.s))*6
		}
		sb.WriteString("\n")
	}

	return sb.String(), nil
}

func abs64(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

// ── Question parser ───────────────────────────────────────────────────────────

var (
	questionRe = regexp.MustCompile(`^(\d{1,2})\.\s+(.+)`)
	optionRe   = regexp.MustCompile(`^([A-FА-ЕА-Е])\)\s*(.+)`)
	imageMarRe = regexp.MustCompile(`\[IMAGE:([^\]]+)\]`)
)

func parseImportedText(text string) ImportResult {
	var result ImportResult
	result.Questions = []ImportQuestion{}
	result.Contexts = []ImportContext{}

	lines := strings.Split(text, "\n")

	currentType := "single"
	var currentQ *ImportQuestion
	var ctxBuf strings.Builder
	inContextSection := false
	contextCount := 0

	flush := func() {
		if currentQ != nil {
			result.Questions = append(result.Questions, *currentQ)
			currentQ = nil
		}
	}

	sealContext := func() {
		if inContextSection && ctxBuf.Len() > 0 {
			body := strings.TrimSpace(ctxBuf.String())
			title := ""
			if lines := strings.SplitN(body, "\n", 2); len(lines) >= 1 {
				first := strings.TrimSpace(lines[0])
				if len([]rune(first)) <= 50 {
					title = first
					if len(lines) > 1 {
						body = strings.TrimSpace(lines[1])
					} else {
						body = ""
					}
				}
			}
			contextCount++
			result.Contexts = append(result.Contexts, ImportContext{
				ID: contextCount, Title: title, Body: body,
			})
			ctxBuf.Reset()
		}
	}

	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}

		lower := strings.ToLower(line)

		// Detect section type from "Инструкция:" lines
		if strings.Contains(lower, "нструкци") {
			flush()
			if strings.Contains(lower, "несколько") {
				currentType = "multi"
				inContextSection = false
			} else if strings.Contains(lower, "соответств") {
				currentType = "matching"
				inContextSection = false
			} else if strings.Contains(lower, "контекст") {
				currentType = "context"
				inContextSection = true
			} else if strings.Contains(lower, "одним") || strings.Contains(lower, "одного") {
				currentType = "single"
				inContextSection = false
			}
			continue
		}

		// Detect question line: "N. text"
		if m := questionRe.FindStringSubmatch(line); m != nil {
			sealContext()
			flush()

			var num int
			fmt.Sscanf(m[1], "%d", &num)

			qtype := currentType
			if qtype == "context" {
				qtype = "single" // sub-questions default to single
			}

			var ctxID *int
			if currentType == "context" && contextCount > 0 {
				id := contextCount
				ctxID = &id
			}

			currentQ = &ImportQuestion{
				Num:       num,
				Text:      m[2],
				Options:   []ImportOption{},
				Type:      qtype,
				ContextID: ctxID,
			}
			continue
		}

		// Detect option line: "A) text"
		if m := optionRe.FindStringSubmatch(line); m != nil && currentQ != nil {
			currentQ.Options = append(currentQ.Options, ImportOption{
				Label: strings.ToUpper(m[1]),
				Text:  strings.TrimSpace(m[2]),
			})
			continue
		}

		// Accumulate context body before questions arrive
		if inContextSection && currentQ == nil {
			ctxBuf.WriteString(line)
			ctxBuf.WriteString("\n")
			continue
		}

		// Continuation of question text (before any options)
		if currentQ != nil && len(currentQ.Options) == 0 {
			currentQ.Text += " " + line
		}
	}

	flush()

	// Post-process: extract [IMAGE:url] markers from question text
	for i := range result.Questions {
		q := &result.Questions[i]
		if m := imageMarRe.FindStringSubmatch(q.Text); m != nil {
			q.ImageURL = m[1]
			q.Text = strings.TrimSpace(imageMarRe.ReplaceAllString(q.Text, ""))
		}
	}

	// Post-process: extract embedded options from question text (e.g. "text A) x B) y C) z D) w")
	inlineOptRe := regexp.MustCompile(`\s+([A-FА-Е])\)\s*`)
	for i := range result.Questions {
		q := &result.Questions[i]
		if len(q.Options) > 0 {
			continue
		}
		idxs := inlineOptRe.FindAllStringIndex(q.Text, -1)
		if len(idxs) < 2 {
			continue
		}
		splitAt := idxs[0][0]
		qText := strings.TrimSpace(q.Text[:splitAt])
		rest := q.Text[splitAt:]
		submatches := inlineOptRe.FindAllStringSubmatchIndex(rest, -1)
		for j, sm := range submatches {
			label := strings.ToUpper(rest[sm[2]:sm[3]])
			start := sm[1]
			var end int
			if j+1 < len(submatches) {
				end = submatches[j+1][0]
			} else {
				end = len(rest)
			}
			text := strings.TrimSpace(rest[start:end])
			q.Options = append(q.Options, ImportOption{Label: label, Text: text})
		}
		q.Text = qText
	}

	return result
}
