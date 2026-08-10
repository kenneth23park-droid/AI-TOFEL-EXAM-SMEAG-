#!/usr/bin/env python3
"""Build a one-page human review sheet for rendered SET 9 listening audio.

The STT gate (`smeag-local-ai/qa/stt_loopback.py`) answers "is this clip
defective enough to re-render?" — a machine verdict over the whole set. This
builds the other half: a page where a person plays each clip, reads the script
next to what CrisperWhisper actually heard, and signs it off one by one.

Verdicts are NOT recomputed here. `wer()` and `classify()` are imported from the
gate so the page and CI can never disagree about what PASS/WARN/FAIL means. The
only thing this adds is a word-level alignment for *display* — the gate counts
edits, but a reviewer needs to see which words moved.

The output is a single self-contained HTML file with the data inlined, sitting
next to the audio so `media/tts/*.mp3` resolves by relative path. Open it
directly in a browser; no server needed.

    python3 tools/build_audio_review.py \
        --manifest ../../smeag-local-ai/data/render_manifest.set9-kokoro.json \
        --out _verify_set9_audio.html

Review state (checked / notes) lives in the browser's localStorage keyed by
segment id, so reopening the file keeps your progress. "결과 내보내기" downloads
it as JSON if you want it outside the browser.
"""

from __future__ import annotations

import argparse
import difflib
import html
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent                                   # studyground/sg2
GATE = ROOT.parent.parent / "smeag-local-ai" / "qa"   # smeag-local-ai/qa

sys.path.insert(0, str(GATE))
try:
    from stt_loopback import classify, normalise, wer  # noqa: E402
except ImportError as e:  # pragma: no cover
    sys.exit(f"cannot import the STT gate from {GATE}: {e}")


def duration_of(path: str) -> float:
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", path],
            capture_output=True, text=True, timeout=30,
        )
        return float(r.stdout.strip())
    except Exception:
        return 0.0


def align(ref: list[str], hyp: list[str]) -> tuple[list[dict], list[dict]]:
    """Word-level alignment for display only — the gate owns the scoring.

    Returns (reference tokens, hypothesis tokens), each token tagged `ok`,
    `sub`, `del` (in script, absent from audio) or `ins` (heard, not scripted).
    """
    sm = difflib.SequenceMatcher(a=ref, b=hyp, autojunk=False)
    r_out: list[dict] = []
    h_out: list[dict] = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            r_out += [{"w": w, "t": "ok"} for w in ref[i1:i2]]
            h_out += [{"w": w, "t": "ok"} for w in hyp[j1:j2]]
        elif tag == "replace":
            r_out += [{"w": w, "t": "sub"} for w in ref[i1:i2]]
            h_out += [{"w": w, "t": "sub"} for w in hyp[j1:j2]]
        elif tag == "delete":
            r_out += [{"w": w, "t": "del"} for w in ref[i1:i2]]
        elif tag == "insert":
            h_out += [{"w": w, "t": "ins"} for w in hyp[j1:j2]]
    return r_out, h_out


def build_rows(manifest: Path, index_path: Path) -> list[dict]:
    segs = json.loads(manifest.read_text(encoding="utf-8"))
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.is_file() else {}

    rows = []
    for i, s in enumerate(segs, 1):
        sid = s["segment_id"]
        ref_text = s.get("text_tts", "")
        asr_text = s.get("asr_text")
        meta = index.get(sid, {})
        dur = duration_of(s["audio_path"])
        words = len(normalise(ref_text))
        gaps = 0.4 * max(s.get("segment_count", 1) - 1, 0)
        wpm = words / max(dur - gaps, 0.01) * 60 if dur else 0

        row = {
            "n": i,
            "id": sid,
            "audio": f"media/tts/{sid}.mp3",
            "kind": meta.get("kind") or _kind_of(sid),
            "voices": meta.get("voices") or s.get("voices") or [],
            "engineVoices": meta.get("kokoroVoices") or [],
            "provider": meta.get("provider", "kokoro-82M"),
            "speed": meta.get("speed"),
            "preserved": meta.get("preservedReason"),
            "duration": round(dur, 2),
            "words": words,
            "wpm": round(wpm),
            "script": ref_text,
        }

        if not asr_text:
            row.update(verdict="NO-ASR", reason=s.get("asr_error", "not transcribed"),
                       wer=None, refTokens=[], hypTokens=[], asr="")
        else:
            m = wer(ref_text, asr_text)
            verdict, reason = classify(m)
            r_tok, h_tok = align(normalise(ref_text), normalise(asr_text))
            row.update(verdict=verdict, reason=reason, wer=round(m["wer"] * 100, 1),
                       subs=m["substitutions"], dels=m["deletions"], inss=m["insertions"],
                       lengthDelta=m["length_delta"], asr=asr_text,
                       refTokens=r_tok, hypTokens=h_tok)
        rows.append(row)
    return rows


def _kind_of(sid: str) -> str:
    for key in ("repeat", "interview", "conv", "ann", "sr"):
        if f"-{key}" in sid:
            return {"conv": "conversation", "ann": "announcement", "sr": "short"}.get(key, key)
    return "?"


TEMPLATE = """<!doctype html>
<meta charset="utf-8">
<title>SET 9 오디오 검수 — CrisperWhisper 대조</title>
<style>
:root{--bg:#fff;--fg:#15171a;--mut:#6b7280;--line:#e5e7eb;--card:#fff;
      --ok:#0f7b3d;--okbg:#dcfce7;--warn:#92400e;--warnbg:#fef3c7;--bad:#991b1b;--badbg:#fee2e2;
      --sub:#b45309;--subbg:#fef3c7;--del:#991b1b;--delbg:#fee2e2;--ins:#1e40af;--insbg:#dbeafe;}
@media (prefers-color-scheme:dark){:root{--bg:#0e1013;--fg:#e8eaed;--mut:#9aa0a6;--line:#2a2e35;--card:#161a1f;
      --ok:#4ade80;--okbg:#052e16;--warn:#fcd34d;--warnbg:#3b2f0b;--bad:#fca5a5;--badbg:#450a0a;
      --sub:#fcd34d;--subbg:#3b2f0b;--del:#fca5a5;--delbg:#450a0a;--ins:#93c5fd;--insbg:#1e293b;}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
     font:15px/1.6 -apple-system,BlinkMacSystemFont,"Pretendard","Apple SD Gothic Neo",sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);
       padding:14px 20px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
h1{font-size:17px;margin:0;font-weight:650}
.sum{display:flex;gap:6px;flex-wrap:wrap}
.pill{font-size:12px;padding:3px 9px;border-radius:99px;font-weight:600;white-space:nowrap}
.PASS{background:var(--okbg);color:var(--ok)} .WARN{background:var(--warnbg);color:var(--warn)}
.REJECT,.FAIL,.NO-ASR{background:var(--badbg);color:var(--bad)}
button{font:inherit;font-size:13px;padding:5px 11px;border:1px solid var(--line);border-radius:7px;
       background:var(--card);color:var(--fg);cursor:pointer}
button.on{background:var(--fg);color:var(--bg);border-color:var(--fg)}
main{padding:18px 20px;max-width:1000px;margin:0 auto}
.card{border:1px solid var(--line);border-radius:11px;padding:15px 17px;margin-bottom:13px;background:var(--card)}
.card.done{opacity:.5}
.top{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:9px}
.idx{font-variant-numeric:tabular-nums;color:var(--mut);font-size:13px;min-width:26px}
.sid{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;font-weight:600}
.meta{color:var(--mut);font-size:12px;margin-left:auto;text-align:right}
audio{width:100%;margin:8px 0 11px;height:34px}
.lab{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin:9px 0 3px;font-weight:600}
.txt{font-size:14px;word-break:break-word}
.ok{} .sub{background:var(--subbg);color:var(--sub);border-radius:3px;padding:0 2px}
.del{background:var(--delbg);color:var(--del);border-radius:3px;padding:0 2px;text-decoration:line-through}
.ins{background:var(--insbg);color:var(--ins);border-radius:3px;padding:0 2px}
.why{font-size:12.5px;color:var(--mut);margin-top:7px}
.sign{display:flex;gap:9px;align-items:center;margin-top:11px;padding-top:11px;border-top:1px solid var(--line)}
.sign label{font-size:13px;display:flex;gap:6px;align-items:center;cursor:pointer;user-select:none}
.sign input[type=text]{flex:1;font:inherit;font-size:13px;padding:5px 9px;border:1px solid var(--line);
       border-radius:7px;background:var(--bg);color:var(--fg)}
.legend{font-size:12px;color:var(--mut);margin:0 0 15px}
.legend span{margin-right:11px}
.none{color:var(--mut);font-style:italic}
</style>
<header>
  <h1>SET 9 오디오 검수</h1>
  <div class="sum" id="sum"></div>
  <div style="display:flex;gap:6px;margin-left:auto;flex-wrap:wrap">
    <button data-f="all" class="on">전체</button>
    <button data-f="todo">미검수</button>
    <button data-f="flag">플래그만</button>
    <button id="exp">결과 내보내기</button>
  </div>
</header>
<main>
  <p class="legend">
    <span><b>대조 표기</b></span>
    <span class="sub">치환</span><span class="del">누락(대본엔 있으나 안 들림)</span>
    <span class="ins">삽입(대본에 없는데 들림)</span>
    — 판정은 <code>stt_loopback.py</code> 기준(WARN&nbsp;2%, REJECT&nbsp;5%).
  </p>
  <div id="list"></div>
</main>
<script>
const DATA = __DATA__;
const KEY = 'sg2-set9-audio-review';
let state = JSON.parse(localStorage.getItem(KEY) || '{}');
let filter = 'all';
const save = () => localStorage.setItem(KEY, JSON.stringify(state));
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const toks = a => a.length ? a.map(t => `<span class="${t.t}">${esc(t.w)}</span>`).join(' ')
                           : '<span class="none">(없음)</span>';

function summary(){
  const c = {PASS:0, WARN:0, REJECT:0, 'NO-ASR':0};
  DATA.forEach(r => c[r.verdict] = (c[r.verdict]||0)+1);
  const done = DATA.filter(r => state[r.id]?.ok).length;
  document.getElementById('sum').innerHTML =
    Object.entries(c).filter(([,n]) => n).map(([k,n]) => `<span class="pill ${k}">${k} ${n}</span>`).join('')
    + `<span class="pill" style="background:var(--line);color:var(--fg)">검수 ${done}/${DATA.length}</span>`;
}

function render(){
  const rows = DATA.filter(r =>
    filter === 'all'  ? true :
    filter === 'todo' ? !state[r.id]?.ok :
                        r.verdict !== 'PASS');
  document.getElementById('list').innerHTML = rows.map(r => {
    const st = state[r.id] || {};
    const voices = [r.voices.join(', '), r.engineVoices.join(', ')].filter(Boolean).join(' → ');
    const stats = r.wer === null ? '전사 없음'
      : `WER ${r.wer}% · 치환 ${r.subs} 누락 ${r.dels} 삽입 ${r.inss}`;
    return `<div class="card ${st.ok ? 'done' : ''}" data-id="${r.id}">
      <div class="top">
        <span class="idx">${r.n}</span>
        <span class="sid">${esc(r.id)}</span>
        <span class="pill ${r.verdict}">${r.verdict}</span>
        <span class="meta">${esc(voices)}<br>${r.duration}s · ${r.wpm} wpm · ${r.words}단어${
          r.speed ? ' · ×' + r.speed : ''}</span>
      </div>
      <audio controls preload="none" src="${esc(r.audio)}"></audio>
      ${r.preserved ? `<div class="why"><b>보존됨</b> — ${esc(r.preserved)}</div>` : ''}
      <div class="lab">대본</div><div class="txt">${toks(r.refTokens)}</div>
      <div class="lab">CrisperWhisper 가 들은 것</div><div class="txt">${toks(r.hypTokens)}</div>
      <div class="why">${esc(stats)} — ${esc(r.reason)}</div>
      <div class="sign">
        <label><input type="checkbox" ${st.ok ? 'checked' : ''} data-k="ok"> 검수 완료</label>
        <input type="text" placeholder="메모 (재렌더 필요, 발음 이상 등)" value="${esc(st.note || '')}" data-k="note">
      </div>
    </div>`;
  }).join('') || '<p class="none">해당 항목이 없습니다.</p>';
  summary();
}

document.getElementById('list').addEventListener('change', e => {
  const card = e.target.closest('.card'); if (!card) return;
  const id = card.dataset.id, k = e.target.dataset.k; if (!k) return;
  state[id] = state[id] || {};
  state[id][k] = k === 'ok' ? e.target.checked : e.target.value;
  save();
  if (k === 'ok') { card.classList.toggle('done', e.target.checked); summary(); }
});
document.getElementById('list').addEventListener('input', e => {
  if (e.target.dataset.k !== 'note') return;
  const id = e.target.closest('.card').dataset.id;
  state[id] = state[id] || {}; state[id].note = e.target.value; save();
});
document.querySelectorAll('button[data-f]').forEach(b => b.onclick = () => {
  document.querySelectorAll('button[data-f]').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); filter = b.dataset.f; render();
});
document.getElementById('exp').onclick = () => {
  const out = DATA.map(r => ({id:r.id, verdict:r.verdict, wer:r.wer,
                              reviewed: !!state[r.id]?.ok, note: state[r.id]?.note || ''}));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], {type:'application/json'}));
  a.download = 'set9-audio-review.json'; a.click();
};
render();
</script>
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True, help="render manifest with asr_text filled in")
    ap.add_argument("--index", default=str(ROOT / "media" / "tts" / "index.json"))
    ap.add_argument("--out", default=str(ROOT / "_verify_set9_audio.html"))
    args = ap.parse_args()

    rows = build_rows(Path(args.manifest), Path(args.index))
    page = TEMPLATE.replace("__DATA__", json.dumps(rows, ensure_ascii=False))
    dest = Path(args.out)
    dest.write_text(page, encoding="utf-8")

    tally: dict[str, int] = {}
    for r in rows:
        tally[r["verdict"]] = tally.get(r["verdict"], 0) + 1
    print(f"{len(rows)} segments -> {dest}")
    print("  " + " · ".join(f"{k} {v}" for k, v in sorted(tally.items())))
    for r in rows:
        if r["verdict"] not in ("PASS",):
            print(f"  {r['verdict']:7} {r['id']:24} {r['reason']}")


if __name__ == "__main__":
    main()
