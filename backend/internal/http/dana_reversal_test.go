package http

import "testing"

// TestDanaLast4 mengunci ekstraksi 4 digit terakhir untuk pencocokan
// reversal (v43a): Connecta mengembalikan masked_dana_id tersamar,
// sementara phone_number-nya bisa berupa placeholder.
func TestDanaLast4(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"62-*******3677", "3677"},
		{"62-******1232", "1232"},
		{"087841903677", "3677"},
		{"6287841903677", "3677"},
		{"", ""},
		{"abc", ""},
		{"123", ""},
		{"1234", "1234"},
		{"+62 878-4190-3677", "3677"},
	}
	for _, c := range cases {
		if got := danaLast4(c.in); got != c.want {
			t.Errorf("danaLast4(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestNormalizeDanaPhone(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"087841903677", "087841903677"},
		{"6287841903677", "087841903677"},
		{"+62 878-4190-3677", "087841903677"},
		{"08112311232", "08112311232"},
		{"0878******77", "087877"},
		{"", ""},
	}
	for _, c := range cases {
		if got := normalizeDanaPhone(c.in); got != c.want {
			t.Errorf("normalizeDanaPhone(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
