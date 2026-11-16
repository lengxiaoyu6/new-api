package dto

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/relaykit/types"
)

// DeepSeekToolsRequest is a DeepSeek Search or Fetch API request
// (/v1/tools/search, /v1/tools/fetch). The body names no model; Model holds
// the routing name. RawBody preserves the original JSON so the body is
// forwarded with unknown fields intact.
type DeepSeekToolsRequest struct {
	Model   string          `json:"model,omitempty"`
	RawBody json.RawMessage `json:"-"`
}

func (r *DeepSeekToolsRequest) GetTokenCountMeta() *types.TokenCountMeta {
	return &types.TokenCountMeta{
		CombineText: string(r.RawBody),
		TokenType:   types.TokenTypeTokenizer,
	}
}

func (r *DeepSeekToolsRequest) IsStream(_ *http.Request) bool {
	return false
}

func (r *DeepSeekToolsRequest) SetModelName(modelName string) {
	if modelName != "" {
		r.Model = modelName
	}
}

// DeepSeek OCR accepts no model field. Model is only the gateway routing name;
// files remain in the host's replayable body storage, outside pricing context.
const (
	MaxOCRFileSize = 100 << 20
	MaxOCRPages    = 1000
)

type DeepSeekOCRRequest struct {
	Model   string `json:"model,omitempty"`
	Purpose string `json:"purpose"`
}

func (r *DeepSeekOCRRequest) GetTokenCountMeta() *types.TokenCountMeta {
	// OCR tokens are reference-only; billing uses page_count.
	return &types.TokenCountMeta{TokenType: types.TokenTypeTokenizer}
}

func (r *DeepSeekOCRRequest) IsStream(_ *http.Request) bool { return false }

func (r *DeepSeekOCRRequest) SetModelName(modelName string) {
	if modelName != "" {
		r.Model = modelName
	}
}

// MaxTTSCharacters is DeepSeek's weighted input limit: Han characters count
// twice, and every other Unicode code point counts once.
const (
	MaxTTSCharacters  = 10000
	MaxTTSRequestSize = 64 << 10
)

// DeepSeekTTSRequest is the native HTTP tools API, distinct from audio/speech.
// Model is host-only; RawBody preserves provider options such as explicit false.
type DeepSeekTTSRequest struct {
	Model          string          `json:"-"`
	Text           string          `json:"text"`
	VoiceID        *string         `json:"voice_id,omitempty"`
	Format         *string         `json:"format,omitempty"`
	FilterMarkdown *bool           `json:"filter_markdown,omitempty"`
	RawBody        json.RawMessage `json:"-"`
	CharacterCount int             `json:"-"`
}

func (r *DeepSeekTTSRequest) Validate() error {
	if strings.TrimSpace(r.Text) == "" || !utf8.ValidString(r.Text) {
		return errors.New("text must be a non-empty UTF-8 string")
	}
	if r.VoiceID != nil && *r.VoiceID != "stella" && *r.VoiceID != "tide" {
		return errors.New("voice_id must be stella or tide")
	}
	if r.Format != nil && *r.Format != "wav" && *r.Format != "pcm" {
		return errors.New("format must be wav or pcm")
	}
	count := 0
	for _, char := range r.Text {
		count++
		if unicode.Is(unicode.Han, char) {
			count++
		}
		if count > MaxTTSCharacters {
			return fmt.Errorf("text must contain at most %d weighted characters", MaxTTSCharacters)
		}
	}
	r.CharacterCount = count
	return nil
}

func (r *DeepSeekTTSRequest) GetTokenCountMeta() *types.TokenCountMeta {
	// Character billing must remain independent from token estimation settings.
	return &types.TokenCountMeta{TokenType: types.TokenTypeTokenizer}
}

func (r *DeepSeekTTSRequest) IsStream(_ *http.Request) bool { return false }

func (r *DeepSeekTTSRequest) SetModelName(modelName string) {
	if modelName != "" {
		r.Model = modelName
	}
}
