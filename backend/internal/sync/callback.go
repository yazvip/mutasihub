// Callback URL validation + test delivery (v42a, Instant Callback).
//
// Q7: hanya https. SSRF guard wajib: tolak IP literal privat/loopback/
// link-local (termasuk 169.254.169.254 metadata cloud) dan hostname yang
// resolve ke alamat seperti itu — baik saat member menyimpan URL (handler
// PUT) maupun sesaat sebelum POST (defense-in-depth di fireCallback,
// karena DNS bisa berubah setelah URL disimpan).
package sync

import (
	"context"
	"database/sql"
	"errors"
	"net"
	"net/url"
	"strings"
)

// lookupIP resolves hostnames for callback validation; overridable in
// tests so unit tests never touch the network.
var lookupIP = func(ctx context.Context, host string) ([]net.IP, error) {
	return net.DefaultResolver.LookupIP(ctx, "ip", host)
}

// Sentinel errors untuk TestCallback — dipetakan handler HTTP ke
// status/kode yang jujur.
var (
	ErrCallbackNotAvailable = errors.New("sync: callback not available on active plan")
	ErrCallbackNoURL        = errors.New("sync: callback url not set")
	// ErrCallbackURLInvalid: target ditolak SSRF guard saat fire (DNS
	// berubah setelah URL disimpan) — handler menjawab 400, bukan 502.
	ErrCallbackURLInvalid = errors.New("sync: callback url invalid")
)

// isBlockedIP reports whether an IP must never receive a callback:
// unspecified, loopback, private (RFC 1918/4193), link-local
// (169.254.0.0/16, fe80::/10) atau multicast.
func isBlockedIP(ip net.IP) bool {
	if ip.IsUnspecified() || ip.IsLoopback() || ip.IsPrivate() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() {
		return true
	}
	// 169.254.169.254 (metadata cloud) sudah termasuk link-local, tapi
	// disebut eksplisit agar penolakan + log menyebutkannya langsung.
	return ip.Equal(net.ParseIP("169.254.169.254"))
}

// ValidateCallbackURL checks a member callback URL (Q7: https saja).
// Panjang maks 512 (batas kolom members.callback_url). Tanpa userinfo.
func ValidateCallbackURL(ctx context.Context, raw string) error {
	if len(raw) > 512 {
		return errors.New("callback URL terlalu panjang (maks 512 karakter)")
	}
	u, err := url.Parse(raw)
	if err != nil || !strings.EqualFold(u.Scheme, "https") || u.Host == "" {
		return errors.New("callback URL harus https dengan host yang valid")
	}
	if u.User != nil {
		return errors.New("callback URL tidak boleh berisi kredensial")
	}
	host := u.Hostname()
	if host == "" {
		return errors.New("callback URL harus punya host")
	}
	if ip := net.ParseIP(host); ip != nil {
		if isBlockedIP(ip) {
			return errors.New("callback URL menunjuk alamat IP privat/lokal")
		}
		return nil
	}
	if strings.EqualFold(host, "localhost") {
		return errors.New("callback URL tidak boleh localhost")
	}
	ips, err := lookupIP(ctx, host)
	if err != nil || len(ips) == 0 {
		return errors.New("callback URL host tidak bisa di-resolve")
	}
	for _, ip := range ips {
		if isBlockedIP(ip) {
			return errors.New("callback URL menunjuk alamat IP privat/lokal")
		}
	}
	return nil
}

// CallbackAvailable reports whether the member's active plan enables
// callbacks (paket callback_enabled=1, mis. Enterprise).
func (s *Syncer) CallbackAvailable(ctx context.Context, memberID string) (bool, error) {
	var enabled int
	err := s.store.DB.QueryRowContext(ctx, `SELECT COALESCE(p.callback_enabled,0)=1 FROM members m
		LEFT JOIN subscriptions sub ON sub.member_id=m.id AND sub.status='active' AND sub.expires_at > NOW()
		LEFT JOIN plans p ON p.id=sub.plan_id WHERE m.id=?`, memberID).Scan(&enabled)
	if err != nil {
		return false, err
	}
	return enabled == 1, nil
}

// TestCallback fires a callback.test event through the same fireCallback
// path as mutation.new (header + baris log sama-sama "callback.test",
// supaya tidak tertukar dengan event asli). Mengembalikan status HTTP
// dan body (dipotong) dari percobaan terakhir.
func (s *Syncer) TestCallback(ctx context.Context, memberID string) (int, string, error) {
	ok, err := s.CallbackAvailable(ctx, memberID)
	if err != nil {
		return 0, "", err
	}
	if !ok {
		return 0, "", ErrCallbackNotAvailable
	}
	var cbURL, cbSecret sql.NullString
	if err := s.store.DB.QueryRowContext(ctx, `SELECT callback_url, callback_secret FROM members WHERE id=?`, memberID).Scan(&cbURL, &cbSecret); err != nil {
		return 0, "", err
	}
	if !cbURL.Valid || cbURL.String == "" {
		return 0, "", ErrCallbackNoURL
	}
	a := &accountRow{MemberID: memberID, CallbackURL: cbURL, CallbackSecret: cbSecret}
	return s.fireCallback(ctx, a, "callback.test", `{"provider":"TEST","account_id":"test","new_mutations":0,"test":true}`)
}
