// Package connecta is the HTTP client for the Connecta B2B Partner API
// (DANA + BCA only; OVO is out of scope). Endpoints are taken from the
// Postman collection supplied by the user. The API key is sent as the
// X-API-KEY header and is never logged.
//
// NOTE: the DANA disbursement endpoint (transfer to balance) is deliberately
// NOT implemented here — the platform is read-only for members.
package connecta

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Client talks to the Connecta B2B Partner API.
type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
	log     *log.Logger
}

// HTTPError carries a non-2xx upstream response: its HTTP status plus the
// raw body, so handlers can map the status and extract a sanitized
// provider message instead of string-matching on the error text.
type HTTPError struct {
	Method string
	Path   string
	Status int
	Body   string
}

func (e *HTTPError) Error() string {
	return fmt.Sprintf("connecta: %s %s returned HTTP %d: %s", e.Method, e.Path, e.Status, truncate(e.Body, 300))
}

// New creates a client. baseURL and apiKey come from env; an empty
// baseURL/apiKey yields a client whose calls fail with a clear error.
func New(baseURL, apiKey string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
		http:    &http.Client{Timeout: 15 * time.Second},
		log:     log.Default(),
	}
}

// Available reports whether the client is configured.
func (c *Client) Available() bool { return c.baseURL != "" && c.apiKey != "" }

// do performs one request, retrying up to 2 extra times on 5xx only.
// It never logs the API key.
func (c *Client) do(ctx context.Context, method, path string, query url.Values, body any) (json.RawMessage, int, error) {
	if !c.Available() {
		return nil, 0, fmt.Errorf("connecta: base URL or API key not configured (CONNECTA_BASE_URL / CONNECTA_API_KEY)")
	}
	var bodyBytes []byte
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, 0, fmt.Errorf("connecta: marshal request: %w", err)
		}
		bodyBytes = b
	}
	u := c.baseURL + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	var lastErr error
	var lastStatus int
	for attempt := 0; attempt <= 2; attempt++ {
		var rdr io.Reader
		if bodyBytes != nil {
			rdr = bytes.NewReader(bodyBytes)
		}
		req, err := http.NewRequestWithContext(ctx, method, u, rdr)
		if err != nil {
			return nil, 0, fmt.Errorf("connecta: build request: %w", err)
		}
		req.Header.Set("X-API-KEY", c.apiKey)
		if bodyBytes != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := c.http.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("connecta: %s %s: %w", method, path, err)
			break // network error: do not retry blindly
		}
		raw, readErr := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		resp.Body.Close()
		if readErr != nil {
			return nil, resp.StatusCode, fmt.Errorf("connecta: read response: %w", readErr)
		}
		c.log.Printf("connecta %s %s -> %d (attempt %d)", method, path, resp.StatusCode, attempt+1)
		lastStatus = resp.StatusCode
		if resp.StatusCode >= 500 && resp.StatusCode <= 599 && attempt < 2 {
			time.Sleep(time.Duration(500*(attempt+1)) * time.Millisecond)
			continue
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, resp.StatusCode, &HTTPError{Method: method, Path: path, Status: resp.StatusCode, Body: string(raw)}
		}
		return json.RawMessage(raw), resp.StatusCode, nil
	}
	if lastErr != nil {
		return nil, lastStatus, lastErr
	}
	return nil, lastStatus, fmt.Errorf("connecta: %s %s failed after retries (last HTTP %d)", method, path, lastStatus)
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}

func (c *Client) get(ctx context.Context, path string, query url.Values) (json.RawMessage, error) {
	raw, _, err := c.do(ctx, http.MethodGet, path, query, nil)
	return raw, err
}

func (c *Client) post(ctx context.Context, path string, body any) (json.RawMessage, error) {
	raw, _, err := c.do(ctx, http.MethodPost, path, nil, body)
	return raw, err
}

// --- 1. Info & quota ---

// Docs fetches GET /b2b/docs.
func (c *Client) Docs(ctx context.Context) (json.RawMessage, error) {
	return c.get(ctx, "/b2b/docs", nil)
}

// Quota fetches GET /b2b/quota.
func (c *Client) Quota(ctx context.Context) (json.RawMessage, error) {
	return c.get(ctx, "/b2b/quota", nil)
}

// WebhookGet fetches GET /b2b/webhook.
func (c *Client) WebhookGet(ctx context.Context) (json.RawMessage, error) {
	return c.get(ctx, "/b2b/webhook", nil)
}

// WebhookSave posts POST /b2b/webhook.
func (c *Client) WebhookSave(ctx context.Context, webhookURL, webhookSecret string) (json.RawMessage, error) {
	return c.post(ctx, "/b2b/webhook", map[string]string{
		"webhook_url":    webhookURL,
		"webhook_secret": webhookSecret,
	})
}

// --- 2. DANA Hub Suite ---

// DanaBinding posts POST /b2b/dana/binding. clientRef is the member_id;
// the binding stays pending until Connecta calls our webhook, and DANA
// redirects the user to redirectURL after OAuth. Real base URL (verified
// live 2026-11-07 via GET /api/v1/b2b/docs): the host alone returns the
// CRM 404 page — the API lives under /api/v1, so CONNECTA_BASE_URL must
// end in /api/v1.
func (c *Client) DanaBinding(ctx context.Context, phone, clientRef, redirectURL string) (json.RawMessage, error) {
	body := map[string]string{"phone": phone, "client_ref": clientRef}
	if redirectURL != "" {
		body["redirect_url"] = redirectURL
	}
	return c.post(ctx, "/b2b/dana/binding", body)
}

// DanaAccounts fetches GET /b2b/dana/accounts.
func (c *Client) DanaAccounts(ctx context.Context) (json.RawMessage, error) {
	return c.get(ctx, "/b2b/dana/accounts", nil)
}

// DanaBalance posts POST /b2b/dana/balance.
func (c *Client) DanaBalance(ctx context.Context, phone string) (json.RawMessage, error) {
	return c.post(ctx, "/b2b/dana/balance", map[string]string{"phone": phone})
}

// DanaProfile posts POST /b2b/dana/profile.
func (c *Client) DanaProfile(ctx context.Context, phone string) (json.RawMessage, error) {
	return c.post(ctx, "/b2b/dana/profile", map[string]string{"phone": phone})
}

// DanaTransaction is one DANA history row (field names are lenient:
// unknown upstream shapes fall back to empty fields, never a crash).
type DanaTransaction struct {
	Date        string `json:"date"`
	Type        string `json:"type"`
	Amount      int64  `json:"amount"`
	Description string `json:"description"`
	Sender      string `json:"sender"`
}

// DanaTransactions fetches GET /b2b/dana/transactions?phone&page&page_size.
func (c *Client) DanaTransactions(ctx context.Context, phone string, page, pageSize int) ([]DanaTransaction, json.RawMessage, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	q := url.Values{
		"phone":     {phone},
		"page":      {strconv.Itoa(page)},
		"page_size": {strconv.Itoa(pageSize)},
	}
	raw, err := c.get(ctx, "/b2b/dana/transactions", q)
	if err != nil {
		return nil, nil, err
	}
	txs, err := parseTxList[DanaTransaction](raw)
	if err != nil {
		return nil, raw, fmt.Errorf("connecta: parse dana transactions: %w", err)
	}
	return txs, raw, nil
}

// DanaBankCodes fetches GET /b2b/dana/bank-codes.
func (c *Client) DanaBankCodes(ctx context.Context) (json.RawMessage, error) {
	return c.get(ctx, "/b2b/dana/bank-codes", nil)
}

// DanaAccountInquiry posts POST /b2b/dana/account-inquiry (SNAP bank
// inquiry). Member access is gated by plans.inquiry_enabled in the
// member handler; the admin handler is admin-only.
func (c *Client) DanaAccountInquiry(ctx context.Context, bankCode, accountNumber string) (json.RawMessage, error) {
	return c.post(ctx, "/b2b/dana/account-inquiry", map[string]string{
		"bank_code":      bankCode,
		"account_number": accountNumber,
	})
}

// --- 3. Mutasi KlikBCA ---

// BCAAccountSave posts POST /b2b/bca/account.
func (c *Client) BCAAccountSave(ctx context.Context, accountNo, userID, pin string) (json.RawMessage, error) {
	return c.post(ctx, "/b2b/bca/account", map[string]string{
		"account_no": accountNo,
		"user_id":    userID,
		"pin":        pin,
	})
}

// BCAAccounts fetches GET /b2b/bca/accounts.
func (c *Client) BCAAccounts(ctx context.Context) (json.RawMessage, error) {
	return c.get(ctx, "/b2b/bca/accounts", nil)
}

// BCACookies posts POST /b2b/bca/cookies (refresh KlikBCA session).
func (c *Client) BCACookies(ctx context.Context, accountNo, jsessionid string) (json.RawMessage, error) {
	return c.post(ctx, "/b2b/bca/cookies", map[string]string{
		"account_no": accountNo,
		"jsessionid": jsessionid,
	})
}

// BCAMutation is one KlikBCA mutation row. AccountNo is populated
// only when the upstream payload carries it (field name varies) —
// sync filters on it when present (P2-9); when absent, the global
// >1-BCA guard in syncBCA is the safety net.
type BCAMutation struct {
	Date        string `json:"date"`
	Type        string `json:"type"`
	Amount      int64  `json:"amount"`
	Description string `json:"description"`
	Sender      string `json:"sender"`
	AccountNo   string `json:"account_no"`
}

// BCAMutations fetches GET /b2b/bca/mutations?limit&type.
func (c *Client) BCAMutations(ctx context.Context, limit int, typ string) ([]BCAMutation, json.RawMessage, error) {
	if limit < 1 || limit > 100 {
		limit = 25
	}
	q := url.Values{"limit": {strconv.Itoa(limit)}}
	if typ != "" {
		q.Set("type", typ)
	}
	raw, err := c.get(ctx, "/b2b/bca/mutations", q)
	if err != nil {
		return nil, nil, err
	}
	txs, err := parseTxList[BCAMutation](raw)
	if err != nil {
		return nil, raw, fmt.Errorf("connecta: parse bca mutations: %w", err)
	}
	return txs, raw, nil
}

// BCASession fetches GET /b2b/bca/session.
func (c *Client) BCASession(ctx context.Context) (json.RawMessage, error) {
	return c.get(ctx, "/b2b/bca/session", nil)
}

// --- 4. Downstream clients ---

// ClientsCreate posts POST /b2b/clients.
func (c *Client) ClientsCreate(ctx context.Context, clientName, phone, callbackURL string) (json.RawMessage, error) {
	return c.post(ctx, "/b2b/clients", map[string]string{
		"client_name":  clientName,
		"phone":        phone,
		"callback_url": callbackURL,
	})
}

// ClientsList fetches GET /b2b/clients.
func (c *Client) ClientsList(ctx context.Context) (json.RawMessage, error) {
	return c.get(ctx, "/b2b/clients", nil)
}

// parseTxList accepts either {"data": [...]} or a bare [...] payload.
func parseTxList[T any](raw json.RawMessage) ([]T, error) {
	var wrapped struct {
		Data []T `json:"data"`
	}
	if err := json.Unmarshal(raw, &wrapped); err == nil && wrapped.Data != nil {
		return wrapped.Data, nil
	}
	var bare []T
	if err := json.Unmarshal(raw, &bare); err != nil {
		return nil, err
	}
	return bare, nil
}
