package handler

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ── DOCX entry point ──────────────────────────────────────────────────────────

func extractDOCXText(data []byte) (string, error) {
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", fmt.Errorf("invalid DOCX: %w", err)
	}

	// Build relationship map: rId → relative path
	relMap := docxParseRels(r)

	// Extract and save images
	imgMap := docxSaveImages(r)

	// Parse document.xml
	xmlData := docxFindFile(r, "word/document.xml")
	if xmlData == nil {
		return "", fmt.Errorf("invalid DOCX: no document.xml")
	}

	return docxExtractText(xmlData, relMap, imgMap), nil
}

// ── ZIP helpers ───────────────────────────────────────────────────────────────

func docxFindFile(r *zip.Reader, name string) []byte {
	for _, f := range r.File {
		if f.Name == name {
			rc, err := f.Open()
			if err != nil {
				return nil
			}
			defer rc.Close()
			data, _ := io.ReadAll(rc)
			return data
		}
	}
	return nil
}

func docxParseRels(r *zip.Reader) map[string]string {
	data := docxFindFile(r, "word/_rels/document.xml.rels")
	if data == nil {
		return nil
	}
	type rel struct {
		ID     string `xml:"Id,attr"`
		Target string `xml:"Target,attr"`
	}
	type rels struct {
		Items []rel `xml:"Relationship"`
	}
	var result rels
	xml.Unmarshal(data, &result)
	m := make(map[string]string)
	for _, rel := range result.Items {
		m[rel.ID] = rel.Target
	}
	return m
}

// Extract all images from word/media/, save to uploads, return basename→url map
func docxSaveImages(r *zip.Reader) map[string]string {
	imgMap := make(map[string]string)
	for _, f := range r.File {
		if !strings.HasPrefix(f.Name, "word/media/") {
			continue
		}
		ext := strings.ToLower(filepath.Ext(f.Name))
		switch ext {
		case ".png", ".jpg", ".jpeg", ".gif", ".webp":
		default:
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		imgData, _ := io.ReadAll(rc)
		rc.Close()

		fname := fmt.Sprintf("%d%s", time.Now().UnixNano(), ext)
		savePath := filepath.Join(".", "static", "uploads", "images", fname)
		os.MkdirAll(filepath.Dir(savePath), 0755)
		if os.WriteFile(savePath, imgData, 0644) == nil {
			imgMap[filepath.Base(f.Name)] = "/static/uploads/images/" + fname
			time.Sleep(time.Millisecond)
		}
	}
	return imgMap
}

// ── Document text extraction ──────────────────────────────────────────────────

const (
	nsW = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
	nsM = "http://schemas.openxmlformats.org/officeDocument/2006/math"
	nsR = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
	nsA = "http://schemas.openxmlformats.org/drawingml/2006/main"
)

func docxExtractText(data []byte, relMap, imgMap map[string]string) string {
	dec := xml.NewDecoder(bytes.NewReader(data))

	var sb strings.Builder
	var paraBuf strings.Builder
	inPara := false
	mathDepth := 0    // > 0 means we're inside m:oMath
	drawingDepth := 0 // > 0 means inside w:drawing or w:pict
	var pendingRel string

	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			local := t.Name.Local

			// Track paragraph boundaries
			if local == "p" && t.Name.Space == nsW {
				inPara = true
				paraBuf.Reset()
			}

			// Track math context
			if local == "oMath" && t.Name.Space == nsM {
				mathDepth++
				if mathDepth == 1 && inPara {
					latex := ommlConvertElement(dec, t.Name)
					paraBuf.WriteString("$" + latex + "$")
					mathDepth--
					continue
				}
			}
			if mathDepth > 0 {
				mathDepth++
				break
			}

			// Track drawing/image context
			if (local == "drawing" || local == "pict") && t.Name.Space == nsW {
				drawingDepth++
			}
			if drawingDepth > 0 {
				drawingDepth++
				// Look for blip (image reference)
				if local == "blip" {
					for _, attr := range t.Attr {
						if attr.Name.Local == "embed" {
							pendingRel = attr.Value
						}
					}
				}
				break
			}

			// Text run content
			if local == "t" && t.Name.Space == nsW && inPara {
				var textBuf strings.Builder
				for {
					inner, ie := dec.Token()
					if ie != nil {
						break
					}
					if cd, ok := inner.(xml.CharData); ok {
						textBuf.Write(cd)
					}
					if el, ok := inner.(xml.EndElement); ok && el.Name.Local == "t" {
						break
					}
				}
				paraBuf.WriteString(textBuf.String())
			}

		case xml.EndElement:
			local := t.Name.Local

			if mathDepth > 0 {
				mathDepth--
				break
			}

			if drawingDepth > 0 {
				drawingDepth--
				if drawingDepth == 0 && inPara && pendingRel != "" {
					// Resolve rId → filename → URL
					target := relMap[pendingRel]
					basename := filepath.Base(target)
					if url, ok := imgMap[basename]; ok {
						paraBuf.WriteString(" [IMAGE:" + url + "]")
					}
					pendingRel = ""
				}
				break
			}

			if local == "p" && t.Name.Space == nsW && inPara {
				line := strings.TrimSpace(paraBuf.String())
				if line != "" {
					sb.WriteString(line)
					sb.WriteString("\n")
				}
				inPara = false
			}
		}
	}

	return sb.String()
}

// ── OMML → LaTeX converter ────────────────────────────────────────────────────

// ommlConvertElement converts from just AFTER the opening tag until the matching closing tag.
func ommlConvertElement(dec *xml.Decoder, end xml.Name) string {
	var children []struct{ name, content string }
	var textBuf strings.Builder

	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			child := ommlConvertElement(dec, t.Name)
			children = append(children, struct{ name, content string }{t.Name.Local, child})
		case xml.EndElement:
			if t.Name.Local == end.Local {
				goto done
			}
		case xml.CharData:
			textBuf.Write(t)
		}
	}

done:
	text := strings.TrimSpace(textBuf.String())
	if text != "" {
		return text
	}

	// Build lookup map for named children
	cm := make(map[string]string)
	var cc []string
	for _, c := range children {
		cm[c.name] = c.content
		cc = append(cc, c.content)
	}
	all := strings.Join(cc, "")

	switch end.Local {
	case "oMath", "oMathPara":
		return all

	case "f": // \frac{num}{den}
		return fmt.Sprintf("\\frac{%s}{%s}", cm["num"], cm["den"])
	case "num", "den":
		return all

	case "sqrt": // \sqrt{e}
		return fmt.Sprintf("\\sqrt{%s}", cm["e"])

	case "rad": // \sqrt[deg]{e}
		deg, e := cm["deg"], cm["e"]
		if deg == "" || deg == "2" {
			return fmt.Sprintf("\\sqrt{%s}", e)
		}
		return fmt.Sprintf("\\sqrt[%s]{%s}", deg, e)

	case "sSup": // x^{n}
		return fmt.Sprintf("%s^{%s}", cm["e"], cm["sup"])
	case "sSub": // x_{n}
		return fmt.Sprintf("%s_{%s}", cm["e"], cm["sub"])
	case "sSubSup": // x_{n}^{m}
		return fmt.Sprintf("%s_{%s}^{%s}", cm["e"], cm["sub"], cm["sup"])

	case "d": // delimiter — brackets
		return fmt.Sprintf("(%s)", cm["e"])

	case "nary": // summation / integral
		chr := cm["chr"]
		sub, sup, e := cm["sub"], cm["sup"], cm["e"]
		switch {
		case strings.Contains(chr, "∫") || chr == "∫":
			return fmt.Sprintf("\\int_{%s}^{%s} %s", sub, sup, e)
		case strings.Contains(chr, "∏") || chr == "∏":
			return fmt.Sprintf("\\prod_{%s}^{%s} %s", sub, sup, e)
		default:
			return fmt.Sprintf("\\sum_{%s}^{%s} %s", sub, sup, e)
		}

	case "func": // sin(x), log_2(x), etc.
		return fmt.Sprintf("%s(%s)", cm["fName"], cm["e"])
	case "fName":
		return all

	case "bar":
		return fmt.Sprintf("\\overline{%s}", cm["e"])
	case "acc":
		return all // accent — just return content

	case "m": // matrix
		return fmt.Sprintf("\\begin{pmatrix}%s\\end{pmatrix}", all)
	case "mr": // matrix row
		// join cells with & and end with \\
		var cells []string
		for _, c := range children {
			cells = append(cells, c.content)
		}
		return strings.Join(cells, " & ") + " \\\\ "

	case "e", "sup", "sub", "deg":
		return all
	case "r", "t":
		return all

	// naryPr properties — extract chr
	case "naryPr":
		return cm["chr"]
	case "chr":
		return all

	default:
		return all
	}
}
