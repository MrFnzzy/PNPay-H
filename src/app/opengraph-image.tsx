import { ImageResponse } from "next/og";

export const alt = "PNPay-H: your counterpart payments, tracked and verified";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: "#EEFBFA", color: "#172C35" }}>
        <div style={{ display: "flex", fontSize: 40, fontWeight: 600, color: "#0798CF" }}>PNPay-H</div>
        <div style={{ display: "flex", fontSize: 76, fontWeight: 600, marginTop: 24, lineHeight: 1.05 }}>Your counterpart payments, tracked and verified</div>
        <div style={{ display: "flex", fontSize: 32, marginTop: 32, color: "#4A6670" }}>Records only. Never handles your money.</div>
      </div>
    ),
    size,
  );
}
