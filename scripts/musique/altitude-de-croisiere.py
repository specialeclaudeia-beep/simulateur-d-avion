"""
« Altitude de croisière » : morceau de fond du jeu, écrit en notation ABC.

Ce script fait deux choses à partir de la même partition :
  1. il écrit la partition ABC (altitude-de-croisiere.abc), lisible et jouable
     dans n'importe quel lecteur ABC (abcjs, Play Sheet Music…) ;
  2. il la joue avec un petit synthétiseur (numpy) et écrit un WAV, que ffmpeg
     transforme en MP3 (réverbération et volume à −18 LUFS comme les autres morceaux).

Lancer : python3 scripts/musique/altitude-de-croisiere.py
Résultat : public/musique/altitude-de-croisiere.mp3
"""

import re
import subprocess
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT_ABC = HERE / "altitude-de-croisiere.abc"
OUT_WAV = HERE / "altitude-de-croisiere.wav"
OUT_MP3 = ROOT / "public" / "musique" / "altitude-de-croisiere.mp3"

TEMPO = 88  # noires par minute
RATE = 44100
KEY_SHARPS = {"F", "C"}  # ré majeur

# ── La partition ──
# Une mesure = 8 croches (L:1/8, M:4/4). Une ligne = une mesure : accord, mélodie.
THEME = [
    # A : le décollage
    ("D", "F2 A2 d3 c"), ("Bm", "B2 F2 d4"), ("G", "B2 d2 g2 f e"), ("A", "e6 z2"),
    ("D", "f2 e d A2 d2"), ("F#m", "c2 A2 F4"), ("G", "G2 B2 d2 e d"), ("A", "c6 z2"),
    ("D", "F2 A2 d3 e"), ("Bm", "f2 d2 B4"), ("G", "g2 f e d2 B2"), ("A", "c2 e2 a4"),
    ("D", "a2 f d A2 f2"), ("F#m", "e2 c A F2 A2"), ("G", "B2 d2 c2 B c"), ("D", "d6 z2"),
    # B : au-dessus des nuages
    ("G", "d2 B G B2 d2"), ("A", "c2 A E A2 c2"), ("F#m", "A2 c2 f3 e"), ("Bm", "d6 z2"),
    ("Em", "B2 e2 g3 f"), ("A", "e2 c A c2 e2"), ("D", "f2 d A d2 f2"), ("A", "e6 z2"),
    ("G", "g2 f e d2 B2"), ("A", "c2 e2 a3 g"), ("F#m", "f2 e c A2 c2"), ("Bm", "d2 f2 b4"),
    ("Em", "g2 f e B2 e2"), ("A", "c4 e4"), ("D", "d8"), ("D", "z8"),
]
INTRO = [("D", "z8"), ("G", "z8"), ("D", "z8"), ("A", "z8")]
OUTRO = [("G", "z8"), ("A", "z8"), ("D", "z8"), ("D", "z8")]

# Notes des accords (nom ABC, sans octave) : fondamentale en premier.
CHORDS = {
    "D": ["D", "F", "A"], "Bm": ["B", "D", "F"], "G": ["G", "B", "D"], "A": ["A", "C", "E"],
    "F#m": ["F", "A", "C"], "Em": ["E", "G", "B"],
}


def pad_bar(ch):
    """Nappe : l'accord tenu toute la mesure, autour du do central."""
    r, t, f = CHORDS[ch]
    return f"[{r}{t}{f}]8" if r in "DEF" else f"[{r},{t}{f}]8"


def arp_bar(ch):
    """Arpège en croches, au-dessus de la nappe."""
    R, T, F = CHORDS[ch]
    r, t, f = R.lower(), T.lower(), F.lower()
    return f"{R} {F} {r} {t} {f} {r} {t} {F}"


def bass_bar(ch):
    """Basse : fondamentale, puis quinte, en blanches."""
    r, _, f = CHORDS[ch]
    return f"{r},,4 {f},,4" if r in "DEFG" else f"{r},,,4 {f},,4"


def abc_text():
    def voice(fn, bars):
        return " | ".join(fn(c, m) for c, m in bars)

    lines = [
        "X:1", "T:Altitude de croisière", "C:Musique du Simulateur de compagnie aérienne",
        "M:4/4", "L:1/8", f"Q:1/4={TEMPO}", "K:D",
        "%%score (1 2) 3 4",
        "V:1 name=\"Mélodie\" clef=treble", "V:2 name=\"Arpèges\" clef=treble",
        "V:3 name=\"Nappe\" clef=treble", "V:4 name=\"Basse\" clef=bass",
    ]
    fns = {
        "1": lambda c, m: f'"{c}"' + m,
        "2": lambda c, m: arp_bar(c),
        "3": lambda c, m: pad_bar(c),
        "4": lambda c, m: bass_bar(c),
    }
    n_intro, n_theme = len(INTRO), len(THEME)
    for v, fn in fns.items():
        lines.append(f"[V:{v}]")
        bars = [fn(c, m) for c, m in INTRO + THEME + OUTRO]
        text = ""
        for i, bar in enumerate(bars):
            if i == n_intro:
                text += "|: "
            text += bar
            if i == n_intro + n_theme - 1:
                text += " :|"
            elif i == len(bars) - 1:
                text += " |]"
            else:
                text += " |"
            text += "\n" if i % 4 == 3 else " "
        lines.append(text.rstrip())
    return "\n".join(lines) + "\n"


# ── Lecture de l'ABC (le sous-ensemble utilisé ici) ──
NOTE_RE = re.compile(r"(\[[^\]]+\]|[\^=_]?[A-Ga-gz][,']*)(\d*)")
SEMI = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def midi_of(tok):
    acc = 0
    if tok[0] in "^=_":
        acc = {"^": 1, "=": 0, "_": -1}[tok[0]]
        tok = tok[1:]
        explicit = True
    else:
        explicit = False
    letter = tok[0]
    up = letter.upper()
    n = 60 + SEMI[up] + (12 if letter.islower() else 0)
    n += 12 * tok.count("'") - 12 * tok.count(",")
    if not explicit and up in KEY_SHARPS:
        acc = 1
    return n + acc


def parse_bar(text):
    """→ liste de (notes MIDI, durée en croches)."""
    out = []
    for m in NOTE_RE.finditer(text):
        tok, ln = m.group(1), int(m.group(2) or 1)
        if tok == "z":
            out.append(([], ln))
        elif tok.startswith("["):
            out.append(([midi_of(t) for t in re.findall(r"[\^=_]?[A-Ga-g][,']*", tok)], ln))
        else:
            out.append(([midi_of(tok)], ln))
    return out


# ── Synthétiseur ──
EIGHTH = 60 / TEMPO / 2


def hz(n):
    return 440 * 2 ** ((n - 69) / 12)


def env(n, a, r, sustain=1.0, decay=None):
    t = np.arange(n) / RATE
    e = np.minimum(1, t / max(a, 1e-4))
    if decay:
        e = e * (sustain + (1 - sustain) * np.exp(-t / decay))
    rel = int(r * RATE)
    if rel and n > rel:
        e[-rel:] *= np.linspace(1, 0, rel)
    return e


def tone(n, freq, kind):
    t = np.arange(n) / RATE
    if kind == "lead":  # piano électrique doux : sinus + harmoniques qui s'éteignent
        s = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(4 * np.pi * freq * t) * np.exp(-t * 3)
        s += 0.12 * np.sin(2 * np.pi * 3.01 * freq * t) * np.exp(-t * 6)
        vib = 1 + 0.003 * np.sin(2 * np.pi * 5 * t) * np.minimum(1, t / 0.4)
        s = s * vib
        return s * env(n, 0.012, 0.25, 0.55, 0.9)
    if kind == "arp":  # cloche légère
        s = np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * 2.0 * freq * t) * np.exp(-t * 8)
        return s * env(n, 0.004, 0.08, 0.0, 0.35)
    if kind == "pad":  # nappe : trois sinus légèrement désaccordés, attaque lente
        s = sum(np.sin(2 * np.pi * freq * d * t + p) for d, p in [(1, 0), (1.004, 1.3), (0.996, 2.1)])
        s += 0.2 * np.sin(4 * np.pi * freq * t)
        return s / 3 * env(n, 0.9, 0.9)
    if kind == "bass":
        s = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(4 * np.pi * freq * t) * np.exp(-t * 4)
        return s * env(n, 0.01, 0.2, 0.6, 0.6)
    raise ValueError(kind)


def render(bars_by_voice, total):
    mix = np.zeros(total + RATE * 3)
    gains = {"lead": 0.30, "arp": 0.085, "pad": 0.07, "bass": 0.22}
    # La nappe déborde un peu sur la mesure suivante (liaison douce).
    overlap = {"lead": 0.05, "arp": 0.25, "pad": 0.6, "bass": 0.1}
    for kind, bars in bars_by_voice.items():
        pos = 0.0
        for bar in bars:
            for notes, ln in parse_bar(bar):
                dur = ln * EIGHTH
                start = int(pos * RATE)
                n = int((dur + overlap[kind]) * RATE)
                for note in notes:
                    seg = tone(n, hz(note), kind) * gains[kind]
                    mix[start:start + n] += seg
                pos += dur
    return mix


def main():
    OUT_ABC.write_text(abc_text(), encoding="utf-8")

    # Le morceau joué : intro, thème deux fois, fin.
    song = INTRO + THEME + THEME + OUTRO
    voices = {
        "lead": [m for _, m in song],
        "arp": [arp_bar(c) for c, _ in song],
        "pad": [pad_bar(c) for c, _ in song],
        "bass": [bass_bar(c) for c, _ in song],
    }
    # La première fois, le thème est joué sans arpèges sur la partie A (plus calme).
    for i in range(len(INTRO), len(INTRO) + 16):
        voices["arp"][i] = "z8"
    total = int(len(song) * 8 * EIGHTH * RATE)
    mix = render(voices, total)
    # Stéréo légère : arpèges un peu à gauche, mélodie au centre (simple décalage).
    left = mix
    right = np.roll(mix, int(0.011 * RATE))
    st = np.stack([left, right], axis=1)
    st /= np.max(np.abs(st)) * 1.05
    pcm = (st * 32767).astype("<i2")
    with wave.open(str(OUT_WAV), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())

    filt = (
        "aecho=0.8:0.6:60|130|240|370:0.35|0.25|0.18|0.12,"
        "afade=t=in:d=2,areverse,afade=t=in:d=4,areverse,"
        "loudnorm=I=-18:TP=-1.5:LRA=11"
    )
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(OUT_WAV),
         "-af", filt, "-ar", "44100", "-b:a", "128k", str(OUT_MP3)],
        check=True,
    )
    OUT_WAV.unlink()
    print("ABC :", OUT_ABC)
    print("MP3 :", OUT_MP3)


if __name__ == "__main__":
    main()
