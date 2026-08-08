import { useEffect, useRef } from "react";

type Mood = "idle" | "thinking" | "working" | "success" | "alert" | "sync";

interface StatusMeta {
  label: string;
  sublabel: string;
  mood: Mood;
  progress: number;
  tone: string;
}

interface BadgePlacement {
  alpha: number;
  offset: number;
  radius: number;
  status: StatusMeta;
  x: number;
  y: number;
}

const SIZE = 466;
const CENTER = SIZE / 2;
const BADGE_RADIUS = 231;

const colors = {
  bg: "#020304",
  cyan: "#63d7ff",
  green: "#32f08c",
  ink: "#eef7f2",
  muted: "#8da09a",
  red: "#ff4b4b",
  yellow: "#ffd35a",
};

const statuses: StatusMeta[] = [
  { label: "READY", sublabel: "AI PARTNER ONLINE", mood: "idle", progress: 0.18, tone: colors.green },
  { label: "THINK", sublabel: "ANALYZING CONTEXT", mood: "thinking", progress: 0.38, tone: colors.cyan },
  { label: "RUN", sublabel: "TASK IN PROGRESS", mood: "working", progress: 0.66, tone: colors.green },
  { label: "FIXED", sublabel: "TASK COMPLETE", mood: "success", progress: 1, tone: colors.green },
  { label: "BUG", sublabel: "ATTENTION REQUIRED", mood: "alert", progress: 0.72, tone: colors.red },
  { label: "SYNC", sublabel: "LINKING DEVICES", mood: "sync", progress: 0.24, tone: colors.cyan },
];

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function pointOnCircle(angle: number, radius: number) {
  const radians = toRadians(angle);
  return [CENTER + Math.cos(radians) * radius, CENTER + Math.sin(radians) * radius] as const;
}

function drawArc(
  context: CanvasRenderingContext2D,
  radius: number,
  start: number,
  end: number,
  color: string,
  width = 7,
  alpha = 1,
) {
  context.save();
  context.globalAlpha *= alpha;
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineCap = "round";
  context.beginPath();
  context.arc(CENTER, CENTER, radius, toRadians(start), toRadians(end));
  context.stroke();
  context.restore();
}

function drawDiamond(context: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  context.beginPath();
  context.moveTo(x, y - ry);
  context.lineTo(x + rx, y);
  context.lineTo(x, y + ry);
  context.lineTo(x - rx, y);
  context.closePath();
}

function drawText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  weight = 800,
) {
  context.save();
  context.fillStyle = color;
  context.font = `${weight} ${size}px "Segoe UI", "Microsoft YaHei UI", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, x, y);
  context.restore();
}

function drawMono(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  context.save();
  context.fillStyle = color;
  context.font = `700 ${size}px "Cascadia Mono", Consolas, monospace`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, x, y);
  context.restore();
}

function drawAvatar(context: CanvasRenderingContext2D, mood: Mood, phase: number) {
  const pulse = mood === "success" ? 1 + Math.sin(phase * Math.PI * 2) * 0.035 : 1;
  context.save();
  context.translate(CENTER, CENTER - 8);
  if (mood === "alert") context.rotate(Math.sin(phase * Math.PI * 14) * 0.035);
  if (mood === "working") context.translate(Math.sin(phase * Math.PI * 4) * 2, 0);
  context.scale(6.1 * pulse, 6.1 * pulse);
  context.translate(-12, -12);

  const body = mood === "alert" ? colors.red : mood === "sync" ? colors.cyan : colors.green;
  const eye = mood === "alert" ? colors.yellow : mood === "thinking" ? colors.cyan : "#effff7";
  context.fillStyle = body;
  context.beginPath();
  context.moveTo(24, 20.541);
  context.lineTo(3.428, 20.541);
  context.lineTo(3.428, 17.115);
  context.lineTo(0, 17.115);
  context.lineTo(0, 3.4);
  context.lineTo(24, 3.4);
  context.closePath();
  context.fill();

  context.fillStyle = colors.bg;
  context.fillRect(3.428, 6.827, 17.144, 10.288);
  context.fillStyle = eye;

  if (mood === "alert") {
    context.beginPath();
    context.moveTo(6.7, 10.2);
    context.lineTo(12.1, 11.8);
    context.lineTo(10.8, 13.35);
    context.lineTo(6.1, 11.75);
    context.closePath();
    context.fill();
    context.beginPath();
    context.moveTo(13.9, 11.8);
    context.lineTo(19.3, 10.2);
    context.lineTo(19.9, 11.75);
    context.lineTo(15.2, 13.35);
    context.closePath();
    context.fill();
  } else if (mood === "thinking") {
    const look = Math.sin(phase * Math.PI * 2) * 0.55;
    const lift = Math.cos(phase * Math.PI * 2) * 0.22;
    drawDiamond(context, 9.35 + look, 11.72 + lift, 1.72, 2.18);
    context.fill();
    drawDiamond(context, 16.2 + look, 11.72 + lift, 1.72, 2.18);
    context.fill();
    context.fillStyle = colors.yellow;
    context.beginPath();
    context.arc(12, 8.42, 0.42 + Math.max(0, Math.sin(phase * Math.PI * 6)) * 0.3, 0, Math.PI * 2);
    context.fill();
  } else {
    const blink = phase > 0.46 && phase < 0.52 ? 0.18 : 1;
    drawDiamond(context, 9.576, 11.919, 2.425, 2.424 * blink);
    context.fill();
    drawDiamond(context, 16.434, 11.918, 2.425, 2.424 * blink);
    context.fill();
  }

  context.restore();
}

function drawBadge(context: CanvasRenderingContext2D, placement: BadgePlacement, elapsed: number) {
  const { alpha, offset, radius, status, x, y } = placement;
  const phase = (elapsed / 2600 + offset) % 1;
  const scale = radius / BADGE_RADIUS;

  context.save();
  context.globalAlpha = alpha;
  context.translate(x - radius, y - radius);
  context.scale(scale, scale);

  context.fillStyle = "#000";
  context.strokeStyle = "rgba(255,255,255,0.08)";
  context.lineWidth = 4;
  context.beginPath();
  context.arc(CENTER, CENTER, BADGE_RADIUS, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  context.save();
  context.beginPath();
  context.arc(CENTER, CENTER, BADGE_RADIUS - 2, 0, Math.PI * 2);
  context.clip();

  const glow = context.createRadialGradient(CENTER - 46, CENTER - 74, 0, CENTER, CENTER, BADGE_RADIUS);
  if (status.mood === "alert") {
    glow.addColorStop(0, "#3a0d0d");
    glow.addColorStop(0.54, "#120506");
  } else if (status.mood === "success") {
    glow.addColorStop(0, "#14301e");
    glow.addColorStop(0.58, "#06110b");
  } else if (status.mood === "sync" || status.mood === "thinking") {
    glow.addColorStop(0, "#0a2630");
    glow.addColorStop(0.6, "#061018");
  } else {
    glow.addColorStop(0, "#0e2a1b");
    glow.addColorStop(0.58, "#07120d");
  }
  glow.addColorStop(1, colors.bg);
  context.fillStyle = glow;
  context.fillRect(0, 0, SIZE, SIZE);

  context.save();
  context.globalAlpha *= 0.1;
  context.strokeStyle = "#d6fff0";
  context.lineWidth = 1;
  for (let lineY = 42; lineY < SIZE; lineY += 13) {
    context.beginPath();
    context.moveTo(0, lineY + Math.sin(phase * Math.PI * 2 + lineY * 0.04) * 1.8);
    context.lineTo(SIZE, lineY);
    context.stroke();
  }
  context.restore();

  drawArc(context, 212, 202, 338, "rgba(141,160,154,0.12)", 1.5);
  drawArc(context, 182, -22, 72, "rgba(99,215,255,0.14)", 1.5);
  drawArc(context, 160, 110, 166, "rgba(50,240,140,0.14)", 1.5);
  drawArc(context, 215, -62, -18 + Math.sin(phase * Math.PI * 2) * 3, colors.green, 5, 0.82);
  drawArc(context, 215, 128, 168, colors.cyan, 5, 0.54);
  drawArc(context, 215, -168, -132, status.tone, 5, 0.72);

  if (status.mood === "sync") {
    for (let index = 0; index < 4; index += 1) {
      const start = phase * 360 + index * 84;
      drawArc(context, 110 + index * 15, start, start + 34, index % 2 ? colors.green : colors.cyan, 4, 0.3 + index * 0.1);
    }
  }

  drawArc(context, 154, -210, 30, "rgba(141,160,154,0.14)", 10);
  const sweep = 240 * status.progress;
  drawArc(context, 154, -210, -210 + sweep, status.tone, 10);
  const [progressX, progressY] = pointOnCircle(-210 + sweep, 154);
  context.save();
  context.globalAlpha *= 0.62 + Math.sin(phase * Math.PI * 2) * 0.18;
  context.fillStyle = status.tone;
  context.beginPath();
  context.arc(progressX, progressY, 5.4, 0, Math.PI * 2);
  context.fill();
  context.restore();

  drawMono(context, status.mood === "alert" ? "ALERT" : "CONNECTED", CENTER, 72, 14, colors.muted);
  drawAvatar(context, status.mood, phase);
  drawText(context, status.label, CENTER, 346, 31, status.tone, 880);
  drawMono(context, status.sublabel, CENTER, 383, 12, colors.ink);
  drawMono(context, "TRAEVIS // STATUS", CENTER, 414, 10, colors.muted);
  context.restore();
  context.restore();
}

function buildPlacements(width: number, height: number): BadgePlacement[] {
  if (width <= 820) {
    const base = Math.min(width * 0.43, height * 0.22);
    return [
      { status: statuses[0], x: width * 0.52, y: height * 0.27, radius: base, alpha: 0.92, offset: 0 },
      { status: statuses[1], x: -width * 0.04, y: height * 0.18, radius: base * 0.66, alpha: 0.58, offset: 0.19 },
      { status: statuses[4], x: width * 1.04, y: height * 0.2, radius: base * 0.68, alpha: 0.62, offset: 0.42 },
      { status: statuses[2], x: width * 0.08, y: height * 0.5, radius: base * 0.7, alpha: 0.32, offset: 0.57 },
      { status: statuses[3], x: width * 0.94, y: height * 0.49, radius: base * 0.7, alpha: 0.38, offset: 0.73 },
      { status: statuses[5], x: width * 0.5, y: height * 0.03, radius: base * 0.62, alpha: 0.3, offset: 0.86 },
    ];
  }

  const base = Math.min(Math.max(width * 0.19, 190), height * 0.34);
  return [
    { status: statuses[0], x: width * 0.73, y: height * 0.42, radius: base, alpha: 0.92, offset: 0 },
    { status: statuses[1], x: width * 0.47, y: height * 0.08, radius: base * 0.68, alpha: 0.43, offset: 0.19 },
    { status: statuses[4], x: width * 1.01, y: height * 0.24, radius: base * 0.77, alpha: 0.62, offset: 0.42 },
    { status: statuses[2], x: width * 0.57, y: height * 0.91, radius: base * 0.7, alpha: 0.38, offset: 0.57 },
    { status: statuses[3], x: width * 0.93, y: height * 0.8, radius: base * 0.8, alpha: 0.54, offset: 0.73 },
    { status: statuses[5], x: width * 0.27, y: height * 0.34, radius: base * 0.68, alpha: 0.2, offset: 0.86 },
  ];
}

export function HeroStatusField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const context = canvas.getContext("2d");
    if (!context) return undefined;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frameId = 0;
    let width = 0;
    let height = 0;
    let lastPaint = 0;

    const render = (timestamp: number) => {
      context.clearRect(0, 0, width, height);
      for (const placement of buildPlacements(width, height)) {
        drawBadge(context, placement, motionQuery.matches ? 0 : timestamp);
      }
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      render(0);
    };

    const animate = (timestamp: number) => {
      if (timestamp - lastPaint >= 1000 / 30) {
        render(timestamp);
        lastPaint = timestamp;
      }
      frameId = window.requestAnimationFrame(animate);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();
    if (!motionQuery.matches) frameId = window.requestAnimationFrame(animate);

    return () => {
      resizeObserver.disconnect();
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="hero__status-field"
      data-testid="hero-status-field"
      role="img"
      aria-label="TRAEVIS 状态表情动画：连接、待机、思考、运行、修复与异常"
    >
      TRAEVIS 状态表情动画
    </canvas>
  );
}
