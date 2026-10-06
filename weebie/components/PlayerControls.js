"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Maximize2, Minimize2, Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { clampSeek, formatTime } from "../lib/playerControls.cjs";

export default function PlayerControls({
  videoRef,
  canControl,
  isBuffering,
  isFullscreen,
  onToggleFullscreen,
  onAutoplayBlocked,
}) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [previewTime, setPreviewTime] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef(null);
  const tapTimer = useRef(null);
  const lastTap = useRef(null);
  const suppressClick = useRef(false);
  const dragging = useRef(false);
  const lastCommittedSeek = useRef(null);
  const visibleRef = useRef(true);
  const playingRef = useRef(false);

  const setVisible = visible => {
    visibleRef.current = visible;
    setControlsVisible(visible);
  };
  const clearHideTimer = () => {
    clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };
  const showControls = () => {
    setVisible(true);
    clearHideTimer();
    if (playingRef.current) {
      hideTimer.current = setTimeout(() => setVisible(false), 3000);
    }
  };
  const toggleControls = () => {
    if (!playingRef.current || !visibleRef.current) {
      showControls();
      return;
    }
    clearHideTimer();
    setVisible(false);
  };
  const seek = delta => {
    if (!canControl) return;
    const video = videoRef?.current;
    if (!video) return;
    video.currentTime = clampSeek(video.currentTime, delta, video.duration);
    setPreviewTime(null);
    showControls();
  };
  const togglePlayback = () => {
    if (!canControl) return;
    const video = videoRef?.current;
    if (!video) return;
    if (video.paused) {
      const playPromise = video.play();
      playPromise?.catch?.(() => onAutoplayBlocked?.());
    } else {
      video.pause();
    }
    showControls();
  };

  useEffect(() => {
    const video = videoRef?.current;
    if (!video) return undefined;
    const update = () => {
      setCurrentTime(video.currentTime || 0);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      playingRef.current = !video.paused;
      setPlaying(playingRef.current);
      if (video.paused) showControls();
    };
    const events = ["durationchange", "ended", "loadedmetadata", "pause", "timeupdate"];
    events.forEach(name => video.addEventListener(name, update));
    const onPlay = () => {
      update();
      showControls();
    };
    video.addEventListener("play", onPlay);
    update();
    if (!video.paused) showControls();
    const interval = setInterval(update, 250);
    return () => {
      events.forEach(name => video.removeEventListener(name, update));
      video.removeEventListener("play", onPlay);
      clearInterval(interval);
      clearHideTimer();
    };
  }, [videoRef]);

  useEffect(() => {
    if (!canControl) return undefined;
    const onKeyDown = event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, button, [contenteditable='true'], [role='textbox']")) return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        seek(-10);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        seek(10);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [canControl, videoRef]);

  useEffect(() => () => {
    clearTimeout(hideTimer.current);
    clearTimeout(tapTimer.current);
  }, []);

  const beginSeek = event => {
    event.stopPropagation();
    dragging.current = true;
    lastCommittedSeek.current = null;
    setPreviewTime(Number(event.currentTarget.value));
  };
  const previewSeek = event => {
    event.stopPropagation();
    const value = Number(event.currentTarget.value);
    setPreviewTime(value);
    if (!dragging.current) commitSeek(value);
  };
  const commitSeek = value => {
    const video = videoRef?.current;
    if (!canControl || !video) return;
    const target = clampSeek(0, value, video.duration);
    if (lastCommittedSeek.current === target) return;
    video.currentTime = target;
    lastCommittedSeek.current = target;
    setPreviewTime(null);
    showControls();
  };
  const endSeek = event => {
    event.stopPropagation();
    if (!dragging.current) return;
    dragging.current = false;
    commitSeek(Number(event.currentTarget.value));
  };
  const handleSurfacePointerUp = event => {
    if (!canControl) return;
    const now = Date.now();
    const side = event.clientX < event.currentTarget.getBoundingClientRect().left + event.currentTarget.clientWidth / 2 ? -1 : 1;
    if (lastTap.current && now - lastTap.current.at <= 320 && lastTap.current.side === side) {
      clearTimeout(tapTimer.current);
      lastTap.current = null;
      suppressClick.current = true;
      seek(side * 10);
      return;
    }
    lastTap.current = { at: now, side };
    suppressClick.current = true;
    clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => {
      lastTap.current = null;
      toggleControls();
    }, 320);
  };
  const shownTime = previewTime ?? currentTime;
  const progress = duration > 0 ? Math.min(100, Math.max(0, shownTime / duration * 100)) : 0;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 select-none touch-manipulation" style={{ touchAction: "manipulation" }}>
      {canControl && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Toggle player controls"
          className="pointer-events-auto absolute inset-0 z-0 h-full w-full cursor-pointer bg-transparent"
          onPointerUp={handleSurfacePointerUp}
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            toggleControls();
          }}
        />
      )}
      {!canControl && (
        <div
          aria-hidden="true"
          className="pointer-events-auto absolute inset-0 z-0 bg-transparent"
          onPointerDown={event => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={event => {
            event.preventDefault();
            event.stopPropagation();
          }}
        />
      )}
      {canControl && (
        <div className={`absolute inset-x-0 top-1/2 z-10 flex -translate-y-1/2 items-center justify-center gap-3 transition-opacity ${controlsVisible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}>
          <button type="button" aria-label="Rewind 10 seconds" onClick={event => { event.stopPropagation(); seek(-10); }} className="grid h-12 w-12 touch-manipulation place-items-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-sm" style={{ touchAction: "manipulation" }}>
            <span className="relative grid place-items-center"><RotateCcw size={25}/><span className="absolute text-[9px] font-bold">10</span></span>
          </button>
          {isBuffering
            ? <span role="status" aria-label="Buffering" className="grid h-16 w-16 place-items-center rounded-full bg-black/55 text-white"><Loader2 size={30} className="animate-spin"/></span>
            : <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={event => { event.stopPropagation(); togglePlayback(); }} className="grid h-16 w-16 touch-manipulation place-items-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-sm" style={{ touchAction: "manipulation" }}>
              {playing ? <Pause size={29} fill="currentColor"/> : <Play size={29} fill="currentColor" className="ml-1"/>}
            </button>}
          <button type="button" aria-label="Forward 10 seconds" onClick={event => { event.stopPropagation(); seek(10); }} className="grid h-12 w-12 touch-manipulation place-items-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-sm" style={{ touchAction: "manipulation" }}>
            <span className="relative grid place-items-center"><RotateCw size={25}/><span className="absolute text-[9px] font-bold">10</span></span>
          </button>
        </div>
      )}
      <div className={`pointer-events-auto absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-3 pb-2 pt-7 text-xs text-white transition-opacity ${canControl && !controlsVisible ? "pointer-events-none opacity-0" : "opacity-100"}`}>
        <span className="min-w-[3rem] text-right tabular-nums" aria-label="Current time">{formatTime(shownTime)}</span>
        {canControl
          ? <input
            type="range"
            aria-label="Seek"
            min="0"
            max={duration || 0}
            step="0.1"
            value={Math.min(shownTime, duration || shownTime)}
            disabled={!duration}
            onPointerDown={beginSeek}
            onPointerUp={endSeek}
            onPointerCancel={endSeek}
            onChange={previewSeek}
            onKeyUp={event => {
              if (event.key.startsWith("Arrow")) commitSeek(Number(event.currentTarget.value));
            }}
            onClick={event => event.stopPropagation()}
            className="h-8 min-w-0 flex-1 cursor-pointer accent-violet-400 disabled:cursor-default"
            style={{ touchAction: "manipulation" }}
          />
          : <div role="progressbar" aria-label="Video progress" aria-valuemin={0} aria-valuemax={duration || 0} aria-valuenow={shownTime} className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/30">
            <div className="h-full rounded-full bg-violet-400" style={{ width: `${progress}%` }}/>
          </div>}
        <span className="min-w-[3rem] tabular-nums" aria-label="Duration">{formatTime(duration)}</span>
        <button type="button" aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={event => { event.stopPropagation(); onToggleFullscreen?.(); }} className="grid h-11 w-11 shrink-0 touch-manipulation place-items-center rounded-full bg-black/55 text-white" style={{ touchAction: "manipulation" }}>
          {isFullscreen ? <Minimize2 size={19}/> : <Maximize2 size={19}/>}
        </button>
      </div>
    </div>
  );
}
