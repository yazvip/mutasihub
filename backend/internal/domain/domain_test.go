package domain

import (
	"testing"
	"time"
)

func intPtr(v int) *int { return &v }

func TestValidatePlan(t *testing.T) {
	valid := Plan{Slug: "pro", Name: "Pro", PriceCents: 90000000, DurationDays: 30,
		MaxAccounts: 5, APIDelayMinutes: 3, NotifIntervalMin: 2}
	if err := ValidatePlan(valid); err != nil {
		t.Fatalf("valid plan rejected: %v", err)
	}
	cases := []struct {
		name string
		mut  func(*Plan)
	}{
		{"empty slug", func(p *Plan) { p.Slug = "" }},
		{"negative price", func(p *Plan) { p.PriceCents = -1 }},
		{"zero duration", func(p *Plan) { p.DurationDays = 0 }},
		{"zero accounts", func(p *Plan) { p.MaxAccounts = 0 }},
		{"negative delay", func(p *Plan) { p.APIDelayMinutes = -1 }},
		{"zero notif interval", func(p *Plan) { p.NotifIntervalMin = 0 }},
		{"slug with space", func(p *Plan) { p.Slug = "pro plan" }},
		{"slug uppercase", func(p *Plan) { p.Slug = "Pro" }},
		{"slug with underscore", func(p *Plan) { p.Slug = "pro_plan" }},
		{"empty name", func(p *Plan) { p.Name = "" }},
		{"price too high", func(p *Plan) { p.PriceCents = 10000000001 }},
		{"duration too long", func(p *Plan) { p.DurationDays = 3651 }},
		{"max accounts too high", func(p *Plan) { p.MaxAccounts = 101 }},
		{"delay too high", func(p *Plan) { p.APIDelayMinutes = 1441 }},
		{"negative inquiry_limit", func(p *Plan) { p.InquiryLimit = intPtr(-1) }},
	}
	for _, tc := range cases {
		p := valid
		tc.mut(&p)
		if err := ValidatePlan(p); err == nil {
			t.Errorf("%s: invalid plan accepted", tc.name)
		}
	}
	// inquiry_limit nil (tanpa batas) dan 0 (tidak ada hit) valid.
	for _, lim := range []*int{nil, intPtr(0), intPtr(100)} {
		p := valid
		p.InquiryLimit = lim
		if err := ValidatePlan(p); err != nil {
			t.Errorf("inquiry_limit %v rejected: %v", lim, err)
		}
	}
}

func TestSubscriptionActive(t *testing.T) {
	now := time.Now()
	if !SubscriptionActive(now.Add(time.Hour), now) {
		t.Fatal("future expiry reported inactive")
	}
	if SubscriptionActive(now.Add(-time.Hour), now) {
		t.Fatal("past expiry reported active")
	}
	if SubscriptionActive(time.Time{}, now) {
		t.Fatal("zero expiry reported active")
	}
}

func TestDefaultPlans(t *testing.T) {
	plans := DefaultPlans()
	if len(plans) != 4 {
		t.Fatalf("got %d default plans, want 4", len(plans))
	}
	bySlug := map[string]Plan{}
	for _, p := range plans {
		if err := ValidatePlan(p); err != nil {
			t.Fatalf("default plan %s invalid: %v", p.Slug, err)
		}
		bySlug[p.Slug] = p
	}
	if bySlug["trial"].PriceCents != 0 || bySlug["trial"].DurationDays != 1 {
		t.Fatalf("trial plan wrong: %+v", bySlug["trial"])
	}
	if bySlug["starter"].PriceCents != 35000000 {
		t.Fatalf("starter price = %d, want 35000000", bySlug["starter"].PriceCents)
	}
	if bySlug["enterprise"].PriceCents != 180000000 || !bySlug["enterprise"].CallbackEnabled {
		t.Fatalf("enterprise plan wrong: %+v", bySlug["enterprise"])
	}
}
