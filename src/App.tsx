import { useEffect, useRef, useState } from "react";
import "./styles.css";

type PresetName =
  | "Normal"
  | "Deep"
  | "High"
  | "Robot"
  | "Alien"
  | "Radio";

type Settings = {
  pitch: number;
  distortion: number;
  echo: number;
  robot: number;
  lowpass: number;
  highpass: number;
  volume: number;
};

const PRESETS: Record<PresetName, Settings> = {
  Normal: {
    pitch: 0,
    distortion: 0,
    echo: 0,
    robot: 0,
    lowpass: 14000,
    highpass: 60,
    volume: 0.8,
  },

  Deep: {
    pitch: -7,
    distortion: 0.08,
    echo: 0.05,
    robot: 0,
    lowpass: 6500,
    highpass: 90,
    volume: 0.8,
  },

  High: {
    pitch: 7,
    distortion: 0.08,
    echo: 0.04,
    robot: 0,
    lowpass: 14000,
    highpass: 100,
    volume: 0.78,
  },

  Robot: {
    pitch: -2,
    distortion: 0.4,
    echo: 0.12,
    robot: 0.9,
    lowpass: 7500,
    highpass: 120,
    volume: 0.7,
  },

  Alien: {
    pitch: 8,
    distortion: 0.3,
    echo: 0.2,
    robot: 0.65,
    lowpass: 9000,
    highpass: 180,
    volume: 0.7,
  },

  Radio: {
    pitch: -1,
    distortion: 0.35,
    echo: 0.08,
    robot: 0,
    lowpass: 3200,
    highpass: 500,
    volume: 0.7,
  },
};

function makeDistortionCurve(amount: number) {
  const size = 44100;
  const curve = new Float32Array(size);

  const drive = 1 + amount * 40;

  for (let i = 0; i < size; i++) {
    const x = (i * 2) / size - 1;
    curve[i] = Math.tanh(x * drive);
  }

  return curve;
}

export default function App() {
  const [running, setRunning] = useState(false);
  const [preset, setPreset] =
    useState<PresetName>("Normal");

  const [pitch, setPitch] = useState(0);
  const [distortion, setDistortion] = useState(0);
  const [echo, setEcho] = useState(0);
  const [robot, setRobot] = useState(0);
  const [volume, setVolume] = useState(0.8);

  const [error, setError] = useState("");

  const contextRef =
    useRef<AudioContext | null>(null);

  const streamRef =
    useRef<MediaStream | null>(null);

  const sourceRef =
    useRef<MediaStreamAudioSourceNode | null>(null);

  const outputRef =
    useRef<GainNode | null>(null);

  const distortionRef =
    useRef<WaveShaperNode | null>(null);

  const delayRef =
    useRef<DelayNode | null>(null);

  const delayGainRef =
    useRef<GainNode | null>(null);

  const highpassRef =
    useRef<BiquadFilterNode | null>(null);

  const lowpassRef =
    useRef<BiquadFilterNode | null>(null);

  const robotOscRef =
    useRef<OscillatorNode | null>(null);

  const robotGainRef =
    useRef<GainNode | null>(null);

  const analyserRef =
    useRef<AnalyserNode | null>(null);

  const animationRef =
    useRef<number | null>(null);

  const updateAudio = () => {
    const ctx = contextRef.current;

    if (!ctx) return;

    const now = ctx.currentTime;

    if (distortionRef.current) {
      distortionRef.current.curve =
        makeDistortionCurve(distortion);
    }

    if (delayGainRef.current) {
      delayGainRef.current.gain.setTargetAtTime(
        echo,
        now,
        0.03
      );
    }

    if (outputRef.current) {
      outputRef.current.gain.setTargetAtTime(
        volume,
        now,
        0.03
      );
    }

    if (highpassRef.current) {
      highpassRef.current.frequency.setTargetAtTime(
        pitch < -3 ? 100 : 70,
        now,
        0.03
      );
    }

    if (lowpassRef.current) {
      lowpassRef.current.frequency.setTargetAtTime(
        pitch > 3 ? 11000 : 14000,
        now,
        0.03
      );
    }

    if (robotGainRef.current) {
      robotGainRef.current.gain.setTargetAtTime(
        robot,
        now,
        0.03
      );
    }
  };

  const start = async () => {
    try {
      setError("");

      const stream =
        await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });

      streamRef.current = stream;

      const context =
        new AudioContext({
          latencyHint: "interactive",
        });

      contextRef.current = context;

      await context.resume();

      const source =
        context.createMediaStreamSource(stream);

      sourceRef.current = source;

      /*
       * INPUT GAIN
       */
      const input =
        context.createGain();

      input.gain.value = 1;

      /*
       * HIGH PASS
       */
      const highpass =
        context.createBiquadFilter();

      highpass.type = "highpass";
      highpass.frequency.value = 70;
      highpass.Q.value = 0.7;

      highpassRef.current = highpass;

      /*
       * LOW PASS
       */
      const lowpass =
        context.createBiquadFilter();

      lowpass.type = "lowpass";
      lowpass.frequency.value = 14000;
      lowpass.Q.value = 0.7;

      lowpassRef.current = lowpass;

      /*
       * DISTORTION
       */
      const distortionNode =
        context.createWaveShaper();

      distortionNode.oversample = "4x";

      distortionNode.curve =
        makeDistortionCurve(distortion);

      distortionRef.current =
        distortionNode;

      /*
       * ECHO
       */
      const delay =
        context.createDelay(1);

      delay.delayTime.value = 0.09;

      delayRef.current = delay;

      const delayGain =
        context.createGain();

      delayGain.gain.value = echo;

      delayGainRef.current =
        delayGain;

      /*
       * OUTPUT
       */
      const output =
        context.createGain();

      output.gain.value = volume;

      outputRef.current = output;

      /*
       * ANALYSER
       */
      const analyser =
        context.createAnalyser();

      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.8;

      analyserRef.current =
        analyser;

      /*
       * ROBOT OSCILLATOR
       */
      const robotOsc =
        context.createOscillator();

      robotOsc.type = "square";
      robotOsc.frequency.value = 30;

      robotOscRef.current =
        robotOsc;

      const robotGain =
        context.createGain();

      robotGain.gain.value = robot;

      robotGainRef.current =
        robotGain;

      /*
       * MAIN AUDIO CHAIN
       *
       * MIC
       * ↓
       * INPUT
       * ↓
       * FILTER
       * ↓
       * DISTORTION
       * ↓
       * LOWPASS
       * ↓
       * OUTPUT
       */
      source.connect(input);

      input.connect(highpass);

      highpass.connect(distortionNode);

      distortionNode.connect(lowpass);

      lowpass.connect(output);

      /*
       * ECHO
       */
      lowpass.connect(delay);

      delay.connect(delayGain);

      delayGain.connect(output);

      /*
       * Robot layer.
       */
      robotOsc.connect(robotGain);

      robotGain.connect(output);

      /*
       * FINAL
       */
      output.connect(analyser);

      analyser.connect(
        context.destination
      );

      robotOsc.start();

      setRunning(true);

      updateAudio();

      startMeter();
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "לא ניתן לגשת למיקרופון."
      );
    }
  };

  const stop = () => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(
        animationRef.current
      );

      animationRef.current = null;
    }

    try {
      robotOscRef.current?.stop();
    } catch {
      // already stopped
    }

    streamRef.current
      ?.getTracks()
      .forEach((track) => {
        track.stop();
      });

    streamRef.current = null;

    if (contextRef.current) {
      contextRef.current.close();
    }

    contextRef.current = null;

    sourceRef.current = null;
    outputRef.current = null;

    distortionRef.current = null;

    delayRef.current = null;
    delayGainRef.current = null;

    highpassRef.current = null;
    lowpassRef.current = null;

    robotOscRef.current = null;
    robotGainRef.current = null;
    analyserRef.current = null;

    setRunning(false);
  };

  const startMeter = () => {
    const analyser =
      analyserRef.current;

    if (!analyser) return;

    const data =
      new Uint8Array(
        analyser.frequencyBinCount
      );

    const tick = () => {
      if (!analyserRef.current) {
        return;
      }

      analyser.getByteTimeDomainData(data);

      animationRef.current =
        requestAnimationFrame(tick);
    };

    tick();
  };

  const applyPreset = (
    name: PresetName
  ) => {
    const settings =
      PRESETS[name];

    setPreset(name);

    setPitch(settings.pitch);
    setDistortion(settings.distortion);
    setEcho(settings.echo);
    setRobot(settings.robot);
    setVolume(settings.volume);

    /*
     * Radio filter.
     */
    if (highpassRef.current) {
      highpassRef.current.frequency.value =
        settings.highpass;
    }

    if (lowpassRef.current) {
      lowpassRef.current.frequency.value =
        settings.lowpass;
    }

    setTimeout(updateAudio, 0);
  };

  useEffect(() => {
    updateAudio();
  }, [
    pitch,
    distortion,
    echo,
    robot,
    volume,
  ]);

  useEffect(() => {
    return () => {
      stop();
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
            Transform your microphone
            audio in real time.
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
              AUDIO ENGINE
            </span>

            <strong>
              {running
                ? "Processing microphone"
                : "Microphone stopped"}
            </strong>
          </div>
        </div>

        <div className="meter">
          <div
            className="meter-fill"
            style={{
              width: running
                ? "75%"
                : "3%",
            }}
          />
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">
          <div>
            <span className="small-label">
              PRESETS
            </span>

            <h2>
              Choose a voice
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
                preset === name
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
              EFFECTS
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
                {pitch} semitones
              </strong>
            </div>

            <input
              type="range"
              min="-12"
              max="12"
              step="1"
              value={pitch}
              onChange={(e) =>
                setPitch(
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
              <span>Echo</span>

              <strong>
                {Math.round(echo * 100)}%
              </strong>
            </div>

            <input
              type="range"
              min="0"
              max="0.8"
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

          <label className="control">
            <div className="control-top">
              <span>Volume</span>

              <strong>
                {Math.round(
                  volume * 100
                )}
                %
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
        </div>
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
            onClick={start}
          >
            🎙 Start Voice Changer
          </button>
        ) : (
          <button
            className="stop-button"
            onClick={stop}
          >
            ■ Stop Voice Changer
          </button>
        )}

        <p>
          Use headphones to avoid
          microphone feedback.
        </p>
      </section>
    </main>
  );
}
