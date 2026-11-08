package http

import (
	"database/sql"
	"time"
)

// Zona waktu tampilan: semua tanggal yang dikembalikan API memakai WIB
// (Asia/Jakarta, UTC+7) dengan wall-clock WIB yang benar, sesuai docs.
//
// Latar (P1-6): MySQL live berjalan di CST (UTC+8) dan DSN memakai
// loc=Asia/Shanghai, jadi nilai TIMESTAMP dibaca Go sebagai instant
// dengan lokasi +08:00, sedangkan tx_date (DATETIME) menyimpan
// wall-clock WIB apa adanya. Kedua jenis ini HARUS diformat dengan cara
// yang berbeda:
//   - TIMESTAMP (instant benar): geser ke WIB dengan .In(wibLoc).
//   - tx_date DATETIME (wall-clock sudah WIB): JANGAN digeser —
//     tempelkan saja zona WIB pada wall-clock yang sama.
//   - String mentah "2006-01-02 15:04:05" dari kolom TIMESTAMP:
//     dibaca MySQL dalam zona sesi CST, jadi parse sebagai CST lalu
//     geser ke WIB.
// Jangan pernah memakai time_zone sesi MySQL: itu menggeser baris
// DATETIME lama sebesar 1 jam.

var wibLoc = time.FixedZone("WIB", 7*3600)
var cstLoc = time.FixedZone("CST", 8*3600)

// formatWIB memformat sebuah instant (mis. dari kolom TIMESTAMP, atau
// time.Now() di server CST) sebagai RFC3339 dalam WIB.
func formatWIB(t time.Time) string {
	return t.In(wibLoc).Format(time.RFC3339)
}

// formatWIBWallClock memformat wall-clock tx_date (DATETIME, sudah WIB)
// sebagai RFC3339 dalam WIB tanpa menggeser jamnya.
func formatWIBWallClock(t time.Time) string {
	y, mo, d := t.Date()
	h, mi, s := t.Clock()
	return time.Date(y, mo, d, h, mi, s, t.Nanosecond(), wibLoc).Format(time.RFC3339)
}

// nullableWIBString renders sql.NullString as WIB RFC3339 when valid,
// JSON null otherwise (pasangan nullableString untuk tanggal).
func nullableWIBString(ns sql.NullString) any {
	if ns.Valid {
		return formatWIBString(ns.String)
	}
	return nil
}

// formatWIBString mengubah string tanggal mentah "2006-01-02 15:04:05"
// (wall-clock CST dari kolom TIMESTAMP) menjadi RFC3339 dalam WIB.
// String kosong atau yang tak bisa diparse dikembalikan apa adanya.
func formatWIBString(s string) string {
	if s == "" {
		return s
	}
	for _, layout := range []string{"2006-01-02 15:04:05", "2006-01-02 15:04:05.999999999"} {
		if t, err := time.ParseInLocation(layout, s, cstLoc); err == nil {
			return t.In(wibLoc).Format(time.RFC3339)
		}
	}
	return s
}
