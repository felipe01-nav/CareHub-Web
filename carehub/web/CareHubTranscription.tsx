// CareHub: private meeting transcription.
//
// The speech model (OpenAI's open Whisper model) runs inside this browser, on
// this computer. The meeting audio is never sent anywhere: not to the Care Hub
// server and not to any outside service. Only the model itself is downloaded
// once (from Hugging Face) and then kept in the browser's cache.
//
// This replaces the stock recorder, which streamed audio to AssemblyAI. It
// keeps the same shape (start / stop and the same callbacks), so the meeting
// notes block works unchanged. Words arrive a few seconds after each sentence.
import { useState } from 'react';

import audioWorkletUrl from '@/application/integrations/meeting-audio-worklet?worker&url';

export type MeetingAudioSource = 'microphone' | 'meeting';
export type TranscriptionState = 'starting' | 'recording' | 'stopping' | 'idle';

export class MeetingRecordingError extends Error {
  constructor(
    public readonly code: 'unsupported' | 'noSharedAudio' | 'alreadyRecording' | 'connectionFailed' | 'quotaExceeded'
  ) {
    super(code);
  }
}

// ---------------------------------------------------------------------------
// Settings (kept in this browser)
// ---------------------------------------------------------------------------
type Quality = 'fast' | 'accurate';
export type CarehubTranscribeSettings = { language: string; quality: Quality };

const SETTINGS_KEY = 'carehub-transcribe-settings';
const LIB_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';
const MODELS: Record<Quality, string> = {
  fast: 'onnx-community/whisper-base',
  accurate: 'onnx-community/whisper-small',
};
const LANGUAGES: [string, string][] = [
  ['english', 'English'],
  ['portuguese', 'Portuguese'],
  ['spanish', 'Spanish'],
  ['french', 'French'],
  ['german', 'German'],
  ['italian', 'Italian'],
  ['dutch', 'Dutch'],
  ['norwegian', 'Norwegian'],
  ['swedish', 'Swedish'],
  ['danish', 'Danish'],
  ['auto', 'Detect automatically'],
];

export function getTranscribeSettings(): CarehubTranscribeSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') as Partial<CarehubTranscribeSettings>;

    return {
      language: LANGUAGES.some(([value]) => value === saved.language) ? (saved.language as string) : 'english',
      quality: saved.quality === 'accurate' ? 'accurate' : 'fast',
    };
  } catch {
    return { language: 'english', quality: 'fast' };
  }
}

function saveTranscribeSettings(settings: CarehubTranscribeSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // private mode: keep the defaults
  }
}

/** Language and quality pickers, shown above the "Meeting tab / Microphone" buttons. */
export function CareHubTranscribeOptions() {
  const [settings, setSettings] = useState(getTranscribeSettings);
  const update = (patch: Partial<CarehubTranscribeSettings>) => {
    const next = { ...settings, ...patch };

    setSettings(next);
    saveTranscribeSettings(next);
  };
  const selectClass =
    'rounded-md border border-border-primary bg-bg-body px-1.5 py-1 text-xs text-text-primary outline-none';

  return (
    <div className='mb-3 flex flex-col gap-2 text-xs text-text-secondary'>
      <div className='flex flex-wrap items-center gap-3'>
        <label className='flex items-center gap-1.5'>
          Language
          <select className={selectClass} value={settings.language} onChange={(e) => update({ language: e.target.value })}>
            {LANGUAGES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className='flex items-center gap-1.5'>
          Quality
          <select
            className={selectClass}
            value={settings.quality}
            onChange={(e) => update({ quality: e.target.value === 'accurate' ? 'accurate' : 'fast' })}
          >
            <option value='fast'>Fast (about 150 MB download)</option>
            <option value='accurate'>Accurate (about 500 MB download, slower)</option>
          </select>
        </label>
      </div>
      <span>
        🔒 Private: the speech model runs on this computer and the audio never leaves it. The first time, the model is
        downloaded once.
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The speech model runs in a background worker so the page stays smooth.
// ---------------------------------------------------------------------------
const WORKER_SOURCE = [
  "import { pipeline, env } from '" + LIB_URL + "';",
  'env.allowLocalModels = false;',
  "let asr = null; let current = '';",
  'function build(model, gpu) {',
  '  const files = {};',
  '  const progress_callback = (p) => {',
  "    if (!p || p.status !== 'progress' || !p.file) return;",
  '    files[p.file] = [p.loaded || 0, p.total || 0];',
  '    let done = 0; let total = 0;',
  '    for (const key in files) { done += files[key][0]; total += files[key][1]; }',
  "    if (total) self.postMessage({ type: 'progress', percent: Math.floor((done * 100) / total) });",
  '  };',
  '  return pipeline(',
  "    'automatic-speech-recognition',",
  '    model,',
  "    gpu ? { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, progress_callback }",
  "        : { device: 'wasm', dtype: 'q8', progress_callback }",
  '  );',
  '}',
  'async function hasGpu() {',
  '  try { return !!(navigator.gpu && (await navigator.gpu.requestAdapter())); } catch (e) { return false; }',
  '}',
  'async function load(model) {',
  '  if (asr && current === model) return;',
  '  if (asr && asr.dispose) { try { await asr.dispose(); } catch (e) {} }',
  "  asr = null; current = '';",
  '  if (await hasGpu()) {',
  '    try {',
  '      const gpuAsr = await build(model, true);',
  '      await gpuAsr(new Float32Array(16000));',
  '      asr = gpuAsr; current = model; return;',
  '    } catch (e) {}',
  '  }',
  '  asr = await build(model, false); current = model;',
  '}',
  'self.onmessage = async (event) => {',
  '  const data = event.data;',
  '  try {',
  "    if (data.type === 'load') {",
  '      await load(data.model);',
  "      self.postMessage({ id: data.id, type: 'done' });",
  "    } else if (data.type === 'run') {",
  "      if (!asr) throw new Error('The speech model is not ready.');",
  "      const options = { task: 'transcribe' };",
  "      if (data.language && data.language !== 'auto') options.language = data.language;",
  '      const out = await asr(data.audio, options);',
  "      const text = Array.isArray(out) ? out.map((o) => o.text || '').join(' ') : (out && out.text) || '';",
  "      self.postMessage({ id: data.id, type: 'done', text });",
  '    }',
  '  } catch (error) {',
  "    self.postMessage({ id: data.id, type: 'error', message: String((error && error.message) || error) });",
  '  }',
  '};',
].join('\n');

type WorkerReply = { id?: number; type: 'done' | 'error' | 'progress'; text?: string; message?: string; percent?: number };

let worker: Worker | undefined;
let workerUrl: string | undefined;
let callSeq = 0;
const pending = new Map<number, { resolve: (reply: WorkerReply) => void; reject: (error: Error) => void }>();
let progressListener: ((percent: number) => void) | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function disposeWorker() {
  worker?.terminate();
  worker = undefined;
  if (workerUrl) URL.revokeObjectURL(workerUrl);
  workerUrl = undefined;
}

function getWorker() {
  if (worker) return worker;
  workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
  const created = new Worker(workerUrl, { type: 'module' });

  created.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
    if (data.type === 'progress') {
      progressListener?.(data.percent ?? 0);
      return;
    }

    const waiting = data.id === undefined ? undefined : pending.get(data.id);

    if (!waiting || data.id === undefined) return;
    pending.delete(data.id);
    if (data.type === 'error') waiting.reject(new Error(data.message || 'The speech model failed.'));
    else waiting.resolve(data);
  };

  created.onerror = (event) => {
    event.preventDefault();
    const error = new Error(
      'The speech model could not be started. The first time, it needs the internet to download. Please try again.'
    );

    pending.forEach((waiting) => waiting.reject(error));
    pending.clear();
    if (worker === created) disposeWorker();
  };

  worker = created;
  return created;
}

function callWorker(message: Record<string, unknown>, transfer: Transferable[] = []) {
  return new Promise<WorkerReply>((resolve, reject) => {
    const id = ++callSeq;

    pending.set(id, { resolve, reject });
    try {
      getWorker().postMessage({ ...message, id }, transfer);
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

// Free the memory a while after the last meeting (8 GB Macs).
function scheduleIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!pending.size) disposeWorker();
  }, 10 * 60 * 1000);
}

function cancelIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = undefined;
}

// ---------------------------------------------------------------------------
// Audio helpers
// ---------------------------------------------------------------------------
const TARGET_RATE = 16000;
const FRAMES_PER_SECOND = 10; // the audio worklet sends 100 ms pieces
const MIN_SECONDS = 3;
const MAX_SECONDS = 25;
const END_SILENCE_FRAMES = 6; // 0.6 s pause ends a sentence
const LEAD_IN_FRAMES = 4;

function toModelAudio(frames: Float32Array[], rate: number) {
  let length = 0;

  for (const frame of frames) length += frame.length;
  const input = new Float32Array(length);
  let offset = 0;

  for (const frame of frames) {
    input.set(frame, offset);
    offset += frame.length;
  }

  let output = input;

  if (rate !== TARGET_RATE && length) {
    const ratio = rate / TARGET_RATE;

    output = new Float32Array(Math.max(1, Math.floor(length / ratio)));
    if (ratio > 1) {
      for (let i = 0; i < output.length; i++) {
        const start = Math.floor(i * ratio);
        const end = Math.min(length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
        let sum = 0;

        for (let j = start; j < end; j++) sum += input[j];
        output[i] = sum / (end - start);
      }
    } else {
      for (let i = 0; i < output.length; i++) {
        const position = i * ratio;
        const left = Math.floor(position);
        const right = Math.min(length - 1, left + 1);
        const weight = position - left;

        output[i] = input[left] * (1 - weight) + input[right] * weight;
      }
    }
  }

  // Quiet audio: raise the volume a little (at most 8x).
  let peak = 0;

  for (let i = 0; i < output.length; i++) peak = Math.max(peak, Math.abs(output[i]));
  if (peak > 0 && peak < 0.5) {
    const gain = Math.min(8, 0.9 / peak);

    for (let i = 0; i < output.length; i++) output[i] *= gain;
  }

  return output;
}

const MADE_UP = new Set([
  'you',
  'thank you',
  'thank you.',
  'thanks.',
  'thanks for watching!',
  'thanks for watching.',
  'thank you for watching.',
  'thank you for watching!',
  'bye.',
  'bye!',
  'okay.',
  'so.',
]);

// Whisper sometimes writes "[BLANK_AUDIO]", "(music)" or a polite "Thank you." on noise.
function cleanText(raw: string | undefined, voicedFrames: number) {
  const text = (raw || '')
    .replace(/\[[^\]]{0,40}\]|\([^)]{0,40}\)|\*[^*]{0,40}\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!/[\p{L}\p{N}]/u.test(text)) return '';
  if (voicedFrames < 15 && MADE_UP.has(text.toLowerCase())) return '';
  return text;
}

type Piece = { audio: Float32Array; turn: number; voiced: number };

/** One recording: microphone (and meeting tab) -> sentences -> Whisper -> transcript. */
export class MeetingTranscription {
  private static activeSession?: MeetingTranscription;
  private readonly settings = getTranscribeSettings();
  private streams: MediaStream[] = [];
  private context?: AudioContext;
  private processor?: AudioWorkletNode;
  private sampleRate = 48000;
  private closed = false;
  private failed = false;
  private stopping?: Promise<void>;
  private frames: Float32Array[] = [];
  private voiced = 0;
  private silentRun = 0;
  private floor = -1;
  private queue: Piece[] = [];
  private turn = 0;
  private working?: Promise<void>;
  private model?: Promise<void>;
  private modelReady = false;
  private status = '';

  constructor(
    _workspaceId: string,
    private readonly callbacks: {
      onState: (state: TranscriptionState) => void;
      onPartial: (text: string) => void;
      onTranscript: (text: string, turnOrder?: number) => void;
      onError: (error: unknown) => void;
      onPendingDuration: (seconds: number) => void;
    }
  ) {
    void _workspaceId;
  }

  async start(source: MeetingAudioSource, _pendingDuration = 0) {
    void _pendingDuration;
    if (MeetingTranscription.activeSession) throw new MeetingRecordingError('alreadyRecording');
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof AudioContext === 'undefined' ||
      typeof Worker === 'undefined' ||
      (source === 'meeting' && !navigator.mediaDevices.getDisplayMedia)
    )
      throw new MeetingRecordingError('unsupported');
    MeetingTranscription.activeSession = this;
    cancelIdle();
    this.callbacks.onState('starting');
    try {
      // Screen capture must be requested directly from the button click.
      if (source === 'meeting') {
        const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });

        this.addStream(display);
        if (!display.getAudioTracks().length) throw new MeetingRecordingError('noSharedAudio');
      }

      const microphone = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });

      this.addStream(microphone);
      this.callbacks.onPendingDuration(0);
      this.assertOpen();

      // Get the model ready in the background. Audio is kept until it is ready.
      this.model = this.loadModel();
      this.model.catch((error: unknown) => this.fail(error));

      this.context = new AudioContext();
      this.sampleRate = this.context.sampleRate;
      await this.context.audioWorklet.addModule(audioWorkletUrl);
      this.assertOpen();
      this.processor = new AudioWorkletNode(this.context, 'meeting-audio', {
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      this.processor.port.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => this.onFrame(new Int16Array(data));
      for (const stream of this.streams) {
        this.context.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(this.processor);
      }

      this.processor.connect(this.context.destination);
      await this.context.resume();
      this.assertOpen();
      this.callbacks.onState('recording');
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  private assertOpen() {
    if (this.closed) throw new DOMException('Recording cancelled', 'AbortError');
  }

  private addStream(stream: MediaStream) {
    if (this.closed) {
      stream.getTracks().forEach((track) => track.stop());
      this.assertOpen();
    }

    this.streams.push(stream);
    stream.getTracks().forEach((track) =>
      track.addEventListener(
        'ended',
        () => {
          void this.stop();
        },
        { once: true }
      )
    );
  }

  private showStatus() {
    this.callbacks.onPartial(this.status);
  }

  private async loadModel() {
    const listener = (percent: number) => {
      if (this.modelReady) return;
      this.status =
        percent < 100
          ? `Downloading the private speech model (first time only)… ${percent}%`
          : 'Starting the speech model…';
      this.showStatus();
    };

    progressListener = listener;
    this.status = 'Starting the speech model…';
    this.showStatus();
    try {
      await callWorker({ type: 'load', model: MODELS[this.settings.quality] });
      this.modelReady = true;
      this.status = '';
      this.showStatus();
    } finally {
      if (progressListener === listener) progressListener = undefined;
    }
  }

  private onFrame(pcm: Int16Array) {
    if (this.closed) return;
    const frame = new Float32Array(pcm.length);
    let sum = 0;

    for (let i = 0; i < pcm.length; i++) {
      const value = pcm[i] / 32768;

      frame[i] = value;
      sum += value * value;
    }

    const rms = Math.sqrt(sum / Math.max(1, pcm.length));

    // Background level: drops at once, rises slowly.
    if (this.floor < 0 || rms < this.floor) this.floor = rms;
    else this.floor += (rms - this.floor) * 0.002;
    const speech = rms > 0.002 && rms > this.floor * 3;

    this.frames.push(frame);
    if (speech) {
      this.voiced++;
      this.silentRun = 0;
    } else {
      this.silentRun++;
    }

    if (!this.voiced) {
      // Only silence so far: keep a short lead-in.
      if (this.frames.length > LEAD_IN_FRAMES) this.frames.splice(0, this.frames.length - LEAD_IN_FRAMES);
      this.silentRun = 0;
      return;
    }

    const seconds = this.frames.length / FRAMES_PER_SECOND;

    if ((seconds >= MIN_SECONDS && this.silentRun >= END_SILENCE_FRAMES) || seconds >= MAX_SECONDS) this.cut();
  }

  private cut() {
    const frames = this.frames;
    const voiced = this.voiced;

    this.frames = [];
    this.voiced = 0;
    this.silentRun = 0;
    if (voiced < 3) return;
    this.queue.push({ audio: toModelAudio(frames, this.sampleRate), turn: ++this.turn, voiced });
    void this.work().catch((error: unknown) => this.fail(error));
  }

  private work(): Promise<void> {
    if (this.working) return this.working;
    this.working = (async () => {
      try {
        await this.model;
        while (this.queue.length && !this.failed) {
          if (this.queue.length > 2) {
            this.status = `Catching up… (${this.queue.length} parts waiting)`;
            this.showStatus();
          }

          const piece = this.queue.shift() as Piece;
          const reply = await callWorker({ type: 'run', audio: piece.audio, language: this.settings.language }, [
            piece.audio.buffer,
          ]);
          const text = cleanText(reply.text, piece.voiced);

          if (text) this.callbacks.onTranscript(text, piece.turn);
        }

        if (this.status.startsWith('Catching up')) {
          this.status = '';
          this.showStatus();
        }
      } finally {
        this.working = undefined;
      }
    })();
    return this.working;
  }

  private fail(error: unknown) {
    if (this.stopping || this.failed) return;
    this.failed = true;
    this.callbacks.onError(error);
    void this.stop();
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.closed = true;
    this.streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    this.processor?.disconnect();
    if (this.processor) this.processor.port.onmessage = null;
    this.callbacks.onState('stopping');
    this.stopping = (async () => {
      // The last sentence.
      if (this.frames.length && !this.failed) {
        const frames = this.frames;
        const voiced = this.voiced;

        this.frames = [];
        if (voiced >= 3) this.queue.push({ audio: toModelAudio(frames, this.sampleRate), turn: ++this.turn, voiced });
      }

      await this.context?.close().catch(() => undefined);
      if (!this.failed && this.model) {
        try {
          while (this.working || (this.queue.length && !this.failed)) await this.work();
        } catch (error) {
          this.callbacks.onError(error);
        }
      }

      this.status = '';
      this.callbacks.onPartial('');
      if (MeetingTranscription.activeSession === this) MeetingTranscription.activeSession = undefined;
      scheduleIdle();
      this.callbacks.onState('idle');
    })();
    return this.stopping;
  }
}
