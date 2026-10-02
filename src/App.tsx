import { useEffect, useRef, useState } from "react";
import { FormantCorrectionNode } from "@soundtouchjs/formant-correction-worklet";
import processorUrl from "@soundtouchjs/formant-correction-worklet/processor?url";
import "./styles.css";

type PresetName =
  | "Normal"
  | "Deep"
  | "High"
  | "Robot"
  | "Alien"
  | "Radio"
  | "Anonymous";

type Preset = {
  pitch: number;
  timbre: number;
  volume: number;
  echo: number;
  distortion: number;
  robot: number;
  radio: boolean;
};

const PRESETS: Record<PresetName, Preset> = {
  Normal: {
    pitch: 0,
    timbre: 0,
    volume: 0.85,
    echo: 0,
    distortion: 0,
    robot: 0,
    radio: false,
  },

  Deep: {
    pitch: -8,
    timbre: -0.7,
    volume: 0.82,
    echo: 0.08,
    distortion: 0.08,
    robot: 0,
    radio: false,
  },

  High: {
    pitch: 8,
    timbre: 0.6,
    volume: 0.8,
    echo: 0.06,
    distortion: 0.08,
    robot: 0,
    radio: false,
  },

  Robot: {
    pitch: -3,
    timbre: -0.3,
    volume: 0.8,
    echo: 0.12,
    distortion: 0.3,
    robot: 0.95,
    radio: false,
  },

  Alien: {
    pitch: 10,
    timbre: 0.8,
    volume: 0.75,
    echo: 0.22,
    distortion: 0.22,
    robot: 0.65,
    radio: false,
  },

  Radio: {
    pitch: -2,
    timbre: -0.15,
    volume: 0.7,
    echo: 0.1,
    distortion: 0.35,
    robot: 0,
    radio: true,
  },

  Anonymous: {
    pitch: -6,
    timbre: -0.85,
    volume: 0.78,
    echo: 0.05,
    distortion: 0.18,
    robot: 0.2,
    radio: false,
  },
};

function createDistortionCurve(amount: number): WaveShaperNode["curve"] {
  const samples = 44100;
  const curve = new Float32Array(samples);

  const drive = 1 + amount * 80;

  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(x * drive);
  }

  return curve;
}

export default function App() {
  const [running, setRunning] = useState(false);

  const [pitch, setPitch] = useState(0);
  const [timbre, setTimbre] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [echo, setEcho] = useState(0);
  const [distortion, setDistortion] = useState(0);
  const [robot, setRobot] = useState(0);
  const [radio, setRadio] = useState(false);

  const [activePreset, setActivePreset] =
    useState<PresetName>("Normal");

  const [error, setError] = useState("");
  const [level, setLevel] = useState(0);

  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const pitchNodeRef = useRef<FormantCorrectionNode | null>(null);

  const distortionNodeRef = useRef<WaveShaperNode | null>(null);

  const highpassRef = useRef<BiquadFilterNode | null>(null);
  const lowpassRef = useRef<BiquadFilterNode | null>(null);

  const lowShelfRef = useRef<BiquadFilterNode | null>(null);
  const midRef = useRef<BiquadFilterNode | null>(null);
  const highShelfRef = useRef<BiquadFilterNode | null>(null);

  const outputGainRef = useRef<GainNode | null>(null);

  const delayRef = useRef<DelayNode | null>(null);
  const delayGainRef = useRef<GainNode | null>(null);

  const robotOscRef = useRef<OscillatorNode | null>(null);
  const robotGainRef = useRef<GainNode | null>(null);

  const analyserRef = useRef<AnalyserNode | null>(null);

  const animationRef = useRef<number | null>(null);

  const updateAudioParameters = () => {
    const ctx = contextRef.current;

    if (!ctx) return;

    const pitchNode = pitchNodeRef.current;
    const distortionNode = distortionNodeRef.current;

    const highpass = highpassRef.current;
    const lowpass = lowpassRef.current;

    const lowShelf = lowShelfRef.current;
    const mid = midRef.current;
    const highShelf = highShelfRef.current;

    const outputGain = outputGainRef.current;

    const delayGain = delayGainRef.current;

    const robotGain = robotGainRef.current;

    const now = ctx.currentTime;

    if (pitchNode) {
      /*
       * formantStrength = 0 means:
       * do NOT preserve the original formant envelope.
       *
       * This intentionally gives a much stronger pitch/timbre change.
       */
      pitchNode.pitchSemitones.setTargetAtTime(
        pitch,
        now,
        0.015
      );

      pitchNode.formantStrength.setTargetAtTime(
        0,
        now,
        0.015
      );
    }

    if (distortionNode) {
      distortionNode.curve = createDistortionCurve(
        distortion
      );
    }

    if (outputGain) {
      outputGain.gain.setTargetAtTime(
        volume,
        now,
        0.02
      );
    }

    if (delayGain) {
      delayGain.gain.setTargetAtTime(
        echo * 0.55,
        now,
        0.02
      );
    }

    /*
     * TIMBRE SECTION
     *
     * Positive values:
     * brighter / thinner
     *
     * Negative values:
     * darker / heavier
     */

    if (lowShelf) {
      lowShelf.gain.setTargetAtTime(
        timbre * -14,
        now,
        0.03
      );
    }

    if (mid) {
      mid.gain.setTargetAtTime(
        timbre * 10,
        now,
        0.03
      );

      mid.Q.setTargetAtTime(
        1.3 + Math.abs(timbre) * 2,
        now,
        0.03
      );
    }

    if (highShelf) {
      highShelf.gain.setTargetAtTime(
        timbre * 16,
        now,
        0.03
      );
    }

    /*
     * Stronger voice reshaping.
     */
    if (highpass) {
      const hpFrequency = radio
        ? 500
        : 70 + Math.max(0, -timbre) * 90;

      highpass.frequency.setTargetAtTime(
        hpFrequency,
        now,
        0.03
      );
    }

    if (lowpass) {
      const lpFrequency = radio
        ? 3200
        : 12500 - Math.max(0, -timbre) * 5000;

      lowpass.frequency.setTargetAtTime(
        lpFrequency,
        now,
        0.03
      );
    }

    if (robotGain) {
      robotGain.gain.setTargetAtTime(
        robot,
        now,
        0.02
      );
    }
  };

  const startAudio = async () => {
    try {
      setError("");

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "הדפדפן לא תומך בגישה למיקרופון."
        );
      }

      const stream =
        await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            autoGainControl: false,
            noiseSuppression: false,
            channelCount: 1,
          },
        });

      streamRef.current = stream;

      const context = new AudioContext({
        latencyHint: "interactive",
      });

      contextRef.current = context;

      await context.resume();

      /*
       * Register SoundTouch formant processor.
       */
      await FormantCorrectionNode.register(
        context,
        processorUrl
      );

      const source =
        context.createMediaStreamSource(stream);

      sourceRef.current = source;

      /*
       * REAL PITCH SHIFTER
       */
      const pitchNode =
        new FormantCorrectionNode({
          context,
          outputChannelCount: 1,
        });

      pitchNodeRef.current = pitchNode;

      pitchNode.pitch.value = 1;
      pitchNode.pitchSemitones.value = pitch;

      /*
       * Intentionally 0:
       * maximum natural-formant removal from pitch shifting.
       */
      pitchNode.formantStrength.value = 0;

      /*
       * DISTORTION
       */
      const distortionNode =
        context.createWaveShaper();

      distortionNode.oversample = "4x";

      distortionNode.curve =
        createDistortionCurve(distortion);

      distortionNodeRef.current =
        distortionNode;

      /*
       * VOICE SHAPING FILTERS
       */
      const highpass =
        context.createBiquadFilter();

      highpass.type = "highpass";
      highpass.frequency.value = 70;
      highpass.Q.value = 0.7;

      highpassRef.current = highpass;

      const lowpass =
        context.createBiquadFilter();

      lowpass.type = "lowpass";
      lowpass.frequency.value = 12500;
      lowpass.Q.value = 0.7;

      lowpassRef.current = lowpass;

      const lowShelf =
        context.createBiquadFilter();

      lowShelf.type = "lowshelf";
      lowShelf.frequency.value = 180;
      lowShelf.gain.value = 0;

      lowShelfRef.current = lowShelf;

      const mid =
        context.createBiquadFilter();

      mid.type = "peaking";
      mid.frequency.value = 1100;
      mid.Q.value = 1.5;
      mid.gain.value = 0;

      midRef.current = mid;

      const highShelf =
        context.createBiquadFilter();

      highShelf.type = "highshelf";
      highShelf.frequency.value = 3500;
      highShelf.gain.value = 0;

      highShelfRef.current = highShelf;

      /*
       * ECHO
       */
      const delay =
        context.createDelay(1.0);

      delay.delayTime.value = 0.075;

      delayRef.current = delay;

      const delayGain =
        context.createGain();

      delayGain.gain.value = echo;

      delayGainRef.current = delayGain;

      /*
       * OUTPUT
       */
      const outputGain =
        context.createGain();

      outputGain.gain.value = volume;

      outputGainRef.current = outputGain;

      /*
       * ANALYSER
       */
      const analyser =
        context.createAnalyser();

      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.8;

      analyserRef.current = analyser;

      /*
       * ROBOT / RING-MOD STYLE EFFECT
       */
      const robotOsc =
        context.createOscillator();

      robotOsc.type = "square";
      robotOsc.frequency.value = 32;

      robotOscRef.current = robotOsc;

      const robotGain =
        context.createGain();

      robotGain.gain.value = 0;

      robotGainRef.current = robotGain;

      /*
       * Main chain
       *
       * Mic
       *   ↓
       * Pitch
       *   ↓
       * Distortion
       *   ↓
       * EQ / Timbre
       *   ↓
       * Low/High filtering
       *   ↓
       * Output
       */
      source.connect(pitchNode);

      pitchNode.connect(distortionNode);

      distortionNode.connect(lowShelf);

      lowShelf.connect(mid);

      mid.connect(highShelf);

      highShelf.connect(highpass);

      highpass.connect(lowpass);

      /*
       * Main output.
       */
      lowpass.connect(outputGain);

      /*
       * Echo path.
       */
      lowpass.connect(delay);

      delay.connect(delayGain);

      delayGain.connect(outputGain);

      /*
       * Robot modulation layer.
       */
      robotOsc.connect(robotGain);

      robotGain.connect(outputGain);

      /*
       * Final output.
       */
      outputGain.connect(analyser);

      analyser.connect(
        context.destination
      );

      robotOsc.start();

      setRunning(true);

      updateAudioParameters();

      startVisualizer();
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "לא ניתן להפעיל את המיקרופון."
      );

      stopAudio();
    }
  };

  const stopAudio = () => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(
        animationRef.current
      );

      animationRef.current = null;
    }

    robotOscRef.current?.stop();

    robotOscRef.current = null;

    streamRef.current
      ?.getTracks()
      .forEach((track) => track.stop());

    streamRef.current = null;

    if (contextRef.current) {
      contextRef.current.close();
    }

    contextRef.current = null;

    sourceRef.current = null;
    pitchNodeRef.current = null;
    distortionNodeRef.current = null;

    highpassRef.current = null;
    lowpassRef.current = null;

    lowShelfRef.current = null;
    midRef.current = null;
    highShelfRef.current = null;

    outputGainRef.current = null;

    delayRef.current = null;
    delayGainRef.current = null;

    robotGainRef.current = null;

    analyserRef.current = null;

    setLevel(0);
    setRunning(false);
  };

  const startVisualizer = () => {
    const analyser =
      analyserRef.current;

    if (!analyser) return;

    const data =
      new Uint8Array(
        analyser.frequencyBinCount
      );

    const draw = () => {
      if (!analyserRef.current) {
        return;
      }

      analyser.getByteTimeDomainData(
        data
      );

      let sum = 0;

      for (const value of data) {
        const normalized =
          (value - 128) / 128;

        sum += normalized * normalized;
      }

      const rms =
        Math.sqrt(sum / data.length);

      setLevel(
        Math.min(100, rms * 220)
      );

      animationRef.current =
        requestAnimationFrame(draw);
    };

    draw();
  };

  const applyPreset = (
    name: PresetName
  ) => {
    const preset = PRESETS[name];

    setActivePreset(name);

    setPitch(preset.pitch);
    setTimbre(preset.timbre);
    setVolume(preset.volume);
    setEcho(preset.echo);
    setDistortion(preset.distortion);
    setRobot(preset.robot);
    setRadio(preset.radio);

    setTimeout(() => {
      updateAudioParameters();
    }, 0);
  };

  useEffect(() => {
    updateAudioParameters();
  }, [
    pitch,
    timbre,
    volume,
    echo,
    distortion,
    robot,
    radio,
  ]);

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, []);

  return (
    <main className="app">
      <section className="hero">
        <div>
          <div className="badge">
            REAL-TIME VOICE ENGINE
          </div>

          <h1>
            Voice
            <span>Changer</span>
          </h1>

          <p>
            Real-time pitch shifting,
            timbre transformation and
            voice effects — directly in
            your browser.
          </p>
        </div>

        <div
          className={`status ${
            running ? "online" : ""
          }`}
        >
          <span />
          {running
            ? "MIC ACTIVE"
            : "OFFLINE"}
        </div>
      </section>

      <section className="visualizer-card">
        <div className="visualizer-header">
          <div>
            <span className="small-label">
              LIVE SIGNAL
            </span>

            <strong>
              {running
                ? "Voice processing active"
                : "Waiting for microphone"}
            </strong>
          </div>

          <div className="meter-value">
            {Math.round(level)}%
          </div>
        </div>

        <div className="meter">
          <div
            className="meter-fill"
            style={{
              width: `${level}%`,
            }}
          />
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">
          <div>
            <span className="small-label">
              VOICE PRESETS
            </span>

            <h2>
              Choose your voice
            </h2>
          </div>
        </div>

        <div className="presets">
          {(
            Object.keys(
              PRESETS
            ) as PresetName[]
          ).map((name) => (
            <button
              key={name}
              className={
                activePreset === name
                  ? "preset active"
                  : "preset"
              }
              onClick={() =>
                applyPreset(name)
              }
            >
              <span className="preset-icon">
                {name === "Normal" && "◉"}
                {name === "Deep" && "↓"}
                {name === "High" && "↑"}
                {name === "Robot" && "⌬"}
                {name === "Alien" && "✦"}
                {name === "Radio" && "▣"}
                {name === "Anonymous" && "◈"}
              </span>

              <span>{name}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">
          <div>
            <span className="small-label">
              AUDIO ENGINE
            </span>

            <h2>
              Fine tune
            </h2>
          </div>
        </div>

        <div className="controls">
          <label className="control">
            <div className="control-top">
              <span>Pitch</span>
              <strong>
                {pitch > 0 ? "+" : ""}
                {pitch} st
              </strong>
            </div>

            <input
              type="range"
              min="-12"
              max="12"
              step="1"
              value={pitch}
              onChange={(e) => {
                setPitch(
                  Number(e.target.value)
                );

                setActivePreset(
                  "Normal"
                );
              }}
            />
          </label>

          <label className="control">
            <div className="control-top">
              <span>Timbre</span>
              <strong>
                {timbre > 0 ? "+" : ""}
                {timbre.toFixed(2)}
              </strong>
            </div>

            <input
              type="range"
              min="-1"
              max="1"
              step="0.01"
              value={timbre}
              onChange={(e) => {
                setTimbre(
                  Number(e.target.value)
                );

                setActivePreset(
                  "Normal"
                );
              }}
            />
          </label>

          <label className="control">
            <div className="control-top">
              <span>Volume</span>
              <strong>
                {Math.round(volume * 100)}%
              </strong>
            </div>

            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(e) =>
                setVolume(
                  Number(e.target.value)
                )
              }
            />
          </label>

          <label className="control">
            <div className="control-top">
              <span>Echo</span>
              <strong>
                {Math.round(echo * 100)}%
              </strong>
            </div>

            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={echo}
              onChange={(e) =>
                setEcho(
                  Number(e.target.value)
                )
              }
            />
          </label>

          <label className="control">
            <div className="control-top">
              <span>Distortion</span>
              <strong>
                {Math.round(
                  distortion * 100
                )}
                %
              </strong>
            </div>

            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={distortion}
              onChange={(e) =>
                setDistortion(
                  Number(e.target.value)
                )
              }
            />
          </label>

          <label className="control">
            <div className="control-top">
              <span>Robot</span>
              <strong>
                {Math.round(robot * 100)}%
              </strong>
            </div>

            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={robot}
              onChange={(e) =>
                setRobot(
                  Number(e.target.value)
                )
              }
            />
          </label>
        </div>

        <button
          className={
            radio
              ? "radio-toggle active"
              : "radio-toggle"
          }
          onClick={() =>
            setRadio(!radio)
          }
        >
          <span>
            {radio ? "●" : "○"}
          </span>

          Radio / Telephone Filter

          <small>
            {radio ? "ON" : "OFF"}
          </small>
        </button>
      </section>

      {error && (
        <div className="error">
          {error}
        </div>
      )}

      <section className="action-area">
        {!running ? (
          <button
            className="start-button"
            onClick={startAudio}
          >
            <span>🎙</span>
            Start Voice Changer
          </button>
        ) : (
          <button
            className="stop-button"
            onClick={stopAudio}
          >
            <span>■</span>
            Stop
          </button>
        )}

        <p>
          Your microphone audio is
          processed locally in the
          browser.
        </p>
      </section>
    </main>
  );
}
