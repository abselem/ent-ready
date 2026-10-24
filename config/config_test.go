package config

import (
	"strings"
	"testing"
)

func TestBrevoConfiguration(t *testing.T) {
	for _, tc := range []struct {
		name, key, from string
		wantError       bool
	}{
		{"production Brevo without other providers", "fake-test-key", "sender@example.test", false},
		{"missing sender", "fake-test-key", "", true},
		{"invalid sender", "fake-test-key", "invalid", true},
		{"display name is not an email field", "fake-test-key", "Name <sender@example.test>", true},
		{"production without provider", "", "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("APP_ENV", "production")
			t.Setenv("JWT_ACCESS_SECRET", strings.Repeat("a", 32))
			t.Setenv("JWT_REFRESH_SECRET", strings.Repeat("b", 32))
			t.Setenv("RESEND_API_KEY", "")
			t.Setenv("SMTP_HOST", "")
			t.Setenv("SMTP_USERNAME", "")
			t.Setenv("BREVO_API_KEY", tc.key)
			t.Setenv("BREVO_FROM_EMAIL", tc.from)
			t.Setenv("BREVO_FROM_NAME", "ENT Ready")
			cfg, err := Load()
			if (err != nil) != tc.wantError {
				t.Fatalf("Load error=%v, wantError=%v", err, tc.wantError)
			}
			if err == nil && (cfg.Brevo.APIKey != tc.key || cfg.Brevo.FromEmail != tc.from || cfg.Brevo.FromName != "ENT Ready" || cfg.AllowLogOTP) {
				t.Fatal("unexpected Brevo configuration")
			}
		})
	}
}
