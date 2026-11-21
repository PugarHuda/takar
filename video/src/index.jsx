import React from "react";
import { registerRoot, Composition, AbsoluteFill, Sequence, OffthreadVideo, Audio, staticFile, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import scenes from "../src-scenes.json";

const FPS = 30;
const PAD = 0.8; // seconds of air after each voice line
const C = { ink: "#E3EAEE", muted: "#9AABB5", bg: "#141C21", sheet: "#1B252B", gold: "#E0B341", go: "#5BBF86", rule: "#2C3A42" };
const font = "'Segoe UI', system-ui, sans-serif";
const len = (s) => Math.ceil((s.voSec + PAD) * FPS);
const TOTAL = scenes.reduce((a, s) => a + len(s), 0);

function FadeIn({ children, delay = 0 }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: f - delay, fps, config: { damping: 200 } });
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * 24}px)` }}>{children}</div>;
}

function Subtitle({ text, frames }) {
  // The voice line, revealed in step with the narration (chunked by sentence).
  const f = useCurrentFrame();
  const parts = text.split(/(?<=[.?!])\s+/);
  const per = frames / parts.length;
  const i = Math.min(parts.length - 1, Math.floor(f / per));
  return (
    <div style={{ position: "absolute", left: 120, right: 120, bottom: 46, textAlign: "center" }}>
      <span style={{ background: "rgba(10,14,17,.82)", color: C.ink, fontFamily: font, fontSize: 34, lineHeight: 1.35, padding: "10px 18px", borderRadius: 10, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}>{parts[i]}</span>
    </div>
  );
}

function Title({ s }) {
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 30% 30%, #22313a, ${C.bg})`, justifyContent: "center", alignItems: "center" }}>
      <FadeIn><div style={{ fontFamily: font, fontWeight: 800, fontSize: 150, color: C.ink, letterSpacing: -2, textAlign: "center" }}>{s.title}</div></FadeIn>
      <FadeIn delay={12}><div style={{ fontFamily: font, fontSize: 46, color: C.gold, marginTop: 10, textAlign: "center", maxWidth: 1500 }}>{s.subtitle}</div></FadeIn>
    </AbsoluteFill>
  );
}

function Card({ s }) {
  return (
    <AbsoluteFill style={{ background: C.bg, padding: "120px 160px" }}>
      <FadeIn><div style={{ fontFamily: font, fontWeight: 800, fontSize: 76, color: C.ink, marginBottom: 50 }}>{s.title}</div></FadeIn>
      {s.bullets.map((b, i) => (
        <FadeIn key={i} delay={18 + i * 40}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 26, fontFamily: font, fontSize: 50, color: C.ink, margin: "18px 0", background: C.sheet, border: `1px solid ${C.rule}`, borderRadius: 14, padding: "22px 30px" }}>
            <span style={{ color: C.gold, fontWeight: 800 }}>{i + 1}</span><span>{b}</span>
          </div>
        </FadeIn>
      ))}
    </AbsoluteFill>
  );
}

function Clip({ s }) {
  const f = useCurrentFrame();
  const zoom = interpolate(f, [0, len(s)], [1, 1.06]);
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
        <OffthreadVideo src={staticFile(s.clip)} startFrom={Math.round(s.from * FPS)} muted style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      </AbsoluteFill>
      <div style={{ position: "absolute", top: 34, right: 40, fontFamily: "Consolas, monospace", fontSize: 30, color: C.ink, background: "rgba(10,14,17,.85)", border: `1px solid ${C.gold}`, borderRadius: 8, padding: "8px 16px" }}>{s.caption}</div>
    </AbsoluteFill>
  );
}

function Takar() {
  let at = 0;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {scenes.map((s) => {
        const from = at; at += len(s);
        return (
          <Sequence key={s.id} from={from} durationInFrames={len(s)}>
            {s.kind === "title" ? <Title s={s} /> : s.kind === "card" ? <Card s={s} /> : <Clip s={s} />}
            <Audio src={staticFile(`vo/${s.id}.mp3`)} />
            <Subtitle text={s.vo} frames={Math.round(s.voSec * FPS)} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="Takar" component={Takar} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} />);
