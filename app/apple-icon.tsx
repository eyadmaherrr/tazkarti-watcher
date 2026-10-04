import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS home-screen icon: same ticket mark as app/icon.svg, rendered to PNG.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(180deg, #2cc157, #1a8538)",
        }}
      >
        <svg width="150" height="150" viewBox="0 0 64 64">
          <path
            fill="#fff"
            d="M10 20a3 3 0 0 1 3-3h38a3 3 0 0 1 3 3v7a5 5 0 0 0 0 10v7a3 3 0 0 1-3 3H13a3 3 0 0 1-3-3v-7a5 5 0 0 0 0-10v-7Z"
          />
          <path stroke="#219f45" strokeWidth="3" strokeLinecap="round" strokeDasharray="0.1 6" d="M42 22v20" />
          <circle cx="51" cy="13" r="9" fill="#e98a1c" stroke="#fff" strokeWidth="3" />
        </svg>
      </div>
    ),
    size,
  );
}
