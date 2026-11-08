// Package domain holds plan / subscription rules shared by the HTTP
// layer, the sync worker and tests.
package domain

import (
	"errors"
	"regexp"
	"time"
)

// planSlugRe: slug hanya huruf kecil, angka, dan strip (P2-10).
var planSlugRe = regexp.MustCompile(`^[a-z0-9-]+$`)

// Batas atas wajar (P2-10): harga maks Rp100jt (10_000_000_000 sen),
// durasi maks 3650 hari (10 tahun), max_accounts/max_devices maks 100,
// delay/notif maks 1440 menit (1 hari).
const (
	maxPlanPriceCents = 10000000000
	maxPlanDuration   = 3650
	maxPlanAccounts   = 100
	maxPlanDevices    = 100
	maxPlanMinutes    = 1440
)

// Plan mirrors the plans table.
type Plan struct {
	ID               int64  `json:"id"`
	Slug             string `json:"slug"`
	Name             string `json:"name"`
	PriceCents       int64  `json:"price_cents"`
	DurationDays     int    `json:"duration_days"`
	MaxAccounts      int    `json:"max_accounts"`
	APIDelayMinutes  int    `json:"api_delay_minutes"`
	NotifIntervalMin int    `json:"notif_interval_minutes"`
	MaxDevices       int    `json:"max_devices"`
	CallbackEnabled  bool   `json:"callback_enabled"`
	InquiryEnabled   bool   `json:"inquiry_enabled"`
	// InquiryLimit: batas hit inquiry/hari (tanggal WIB). nil = tanpa
	// batas (NULL di DB); 0 = tidak ada hit diizinkan. Pointer agar
	// NULL terbedakan dari 0.
	InquiryLimit *int `json:"inquiry_limit"`
	IsActive     bool `json:"is_active"`
}

// ValidatePlan checks every admin-editable plan field (P2-10).
func ValidatePlan(p Plan) error {
	if p.Slug == "" {
		return errors.New("domain: plan slug is required")
	}
	if !planSlugRe.MatchString(p.Slug) {
		return errors.New("domain: plan slug must match ^[a-z0-9-]+$")
	}
	if len(p.Slug) > 64 {
		return errors.New("domain: plan slug must be at most 64 characters")
	}
	if p.Name == "" {
		return errors.New("domain: plan name is required")
	}
	if len(p.Name) > 128 {
		return errors.New("domain: plan name must be at most 128 characters")
	}
	if p.PriceCents < 0 {
		return errors.New("domain: plan price must not be negative")
	}
	if p.PriceCents > maxPlanPriceCents {
		return errors.New("domain: plan price exceeds the maximum")
	}
	if p.DurationDays < 1 {
		return errors.New("domain: plan duration_days must be >= 1")
	}
	if p.DurationDays > maxPlanDuration {
		return errors.New("domain: plan duration_days must be <= 3650")
	}
	if p.MaxAccounts < 1 {
		return errors.New("domain: plan max_accounts must be >= 1")
	}
	if p.MaxAccounts > maxPlanAccounts {
		return errors.New("domain: plan max_accounts must be <= 100")
	}
	if p.APIDelayMinutes < 0 {
		return errors.New("domain: plan api_delay_minutes must not be negative")
	}
	if p.APIDelayMinutes > maxPlanMinutes {
		return errors.New("domain: plan api_delay_minutes must be <= 1440")
	}
	if p.NotifIntervalMin < 1 {
		return errors.New("domain: plan notif_interval_minutes must be >= 1")
	}
	if p.NotifIntervalMin > maxPlanMinutes {
		return errors.New("domain: plan notif_interval_minutes must be <= 1440")
	}
	if p.MaxDevices < 1 {
		return errors.New("domain: plan max_devices must be >= 1")
	}
	if p.MaxDevices > maxPlanDevices {
		return errors.New("domain: plan max_devices must be <= 100")
	}
	if p.InquiryLimit != nil && *p.InquiryLimit < 0 {
		return errors.New("domain: plan inquiry_limit must not be negative")
	}
	return nil
}

// SubscriptionActive reports whether a subscription is usable at now.
// A zero expiry means "never expires" only when the subscription was
// created that way; here expiry is always set, so zero = inactive.
func SubscriptionActive(expiresAt time.Time, now time.Time) bool {
	if expiresAt.IsZero() {
		return false
	}
	return now.Before(expiresAt)
}

// DefaultPlans returns the four seeded plans used when the database is
// unavailable (public /plans endpoint and trial assignment fallback).
func DefaultPlans() []Plan {
	return []Plan{
		{Slug: "trial", Name: "Trial", PriceCents: 0, DurationDays: 1, MaxAccounts: 2, APIDelayMinutes: 10, NotifIntervalMin: 5, MaxDevices: 1, CallbackEnabled: false, InquiryEnabled: false, IsActive: true},
		{Slug: "starter", Name: "Starter", PriceCents: 35000000, DurationDays: 30, MaxAccounts: 2, APIDelayMinutes: 5, NotifIntervalMin: 3, MaxDevices: 3, CallbackEnabled: false, InquiryEnabled: true, IsActive: true},
		{Slug: "pro", Name: "Pro", PriceCents: 90000000, DurationDays: 30, MaxAccounts: 5, APIDelayMinutes: 3, NotifIntervalMin: 2, MaxDevices: 5, CallbackEnabled: false, InquiryEnabled: true, IsActive: true},
		{Slug: "enterprise", Name: "Enterprise", PriceCents: 180000000, DurationDays: 30, MaxAccounts: 5, APIDelayMinutes: 0, NotifIntervalMin: 1, MaxDevices: 8, CallbackEnabled: true, InquiryEnabled: true, IsActive: true},
	}
}
