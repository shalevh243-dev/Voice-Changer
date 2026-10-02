import { useEffect, useRef, useState } from "react";
import "./styles.css";

type Preset = {
  name: string;
  emoji: string;
  pitch: number;
  volume: number;
  echo: number;
  distortion: number;
  robot: number;
};

const presets: Preset[] = [
  {
    name: "Normal",
    emoji: "🎙️",
    pitch: 1,
    volume: 0.8,
    echo: 0,
    distortion: 0,
    robot: 0,
  },
  {
    name: "Deep",
    emoji: "👹",
    pitch: 0.72,
    volume: 0.8,
    echo: 0.08,
    distortion: 0.08,
    robot: 0,
  },
  {
    name: "High",
    emoji: "🐿️",
    pitch: 1.45,
    volume: 0.8,
    echo: 0.04,
    distortion: 0,
    robot: 0,
  },
  {
    name: "Robot",
    emoji: "🤖",
    pitch: 0.9,
    volume: 0.75,
    echo: 0.15,
    distortion: 0.3,
    robot: 0.8,
  },
  {
    name: "Alien",
    emoji: "👽",
    pitch: 1.3,
    volume: 0.8,
    echo: 0.3,
    distortion: 0.15,
    robot: 0.5,
  },
  {
    name: "Radio",
    emoji: "📻",
    pitch: 0.95,
    volume: 0.8,
    echo: 0.1,
    distortion: 0.3,
    robot: 0,
  },
];

function createDistortionCurve(amount: number) {
  const samples = 44100;
  const curve = new Float32Array(samples);

  if (amount <= 0) {
    for (let i = 0; i < samples; i++) {
      curve[i] = (i * 2) / samples - 1;
    }

    return curve;
  }

  const k = amount * 400;

  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;

    curve[i] =
      ((3 + k) * x * 20 * (Math.PI / 180)) /
      (Math.PI + k * Math.abs(x));
  }

  return curve;
}

function App() {
  const [running, setRunning] = useState(false);

  const [volume, setVolume] = useState(0.8);
  const [pitch, setPitch] = useState(1);
  const [echo, setEcho] = useState(0);
  const [distortion, setDistortion] = useState(0);
  const [robot, setRobot] = useState(0);

  const [activePreset, setActivePreset] = useState("Normal");
  const [error, setError] = useState("");

  const [levels, setLevels] = useState<number[]>(
    Array.from({ length: 36 }, () => 0.08)
  );

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const outputGainRef = useRef<GainNode | null>(null);
  const distortionRef = useRef<WaveShaperNode | null>(null);

  const delayRef = useRef<DelayNode | null>(null);
  const feedbackRef = useRef<GainNode | null>(null);

  const filterRef = useRef<BiquadFilterNode | null>(null);

  const analyserRef = useRef<AnalyserNode | null>(null);

  const robotOscillatorRef = useRef<OscillatorNode | null>(null);
  const robotGainRef = useRef<GainNode | null>(null);

  const animationFrameRef = useRef<number | null>(null);

  const stopVisualizer = () => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    setLevels(Array.from({ length: 36 }, () => 0.08));
  };

  const startVisualizer = () => {
    const analyser = analyserRef.current;

    if (!analyser) return;

    const data = new Uint8Array(analyser.frequencyBinCount);

    const animate = () => {
      analyser.getByteFrequencyData(data);

      const nextLevels = Array.from({ length: 36 }, (_, index) => {
        const start = Math.floor(
          (index / 36) * data.length
        );

        const end = Math.max(
          start + 1,
          Math.floor(((index + 1) / 36) * data.length)
        );

        let total = 0;

        for (let i = start; i < end; i++) {
          total += data[i];
        }

        const average = total / (end - start);

        return Math.max(0.08, Math.min(1, average / 150));
      });

      setLevels(nextLevels);

      animationFrameRef.current =
        requestAnimationFrame(animate);
    };

    animate();
  };

  const stopAudio = () => {
    stopVisualizer();

    if (robotOscillatorRef.current) {
      try {
        robotOscillatorRef.current.stop();
      } catch {
        // Already stopped
      }
    }

    streamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });

    if (audioContextRef.current) {
      void audioContextRef.current.close();
    }

    robotOscillatorRef.current = null;
    robotGainRef.current = null;

    audioContextRef.current = null;
    streamRef.current = null;

    sourceRef.current = null;

    outputGainRef.current = null;
    distortionRef.current = null;

    delayRef.current = null;
    feedbackRef.current = null;

    filterRef.current = null;
    analyserRef.current = null;

    setRunning(false);
  };

  const startAudio = async () => {
    try {
      setError("");

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "Microphone access is not supported."
        );
      }

      const stream =
        await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            autoGainControl: false,
            noiseSuppression: false,
          },
        });

      const AudioContextClass =
        window.AudioContext ||
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;

      if (!AudioContextClass) {
        throw new Error(
          "Web Audio is not supported."
        );
      }

      const context = new AudioContextClass();

      await context.resume();

      const source =
        context.createMediaStreamSource(stream);

      const outputGain =
        context.createGain();

      const distortionNode =
        context.createWaveShaper();

      const delayNode =
        context.createDelay(1);

      const feedbackNode =
        context.createGain();

      const filterNode =
        context.createBiquadFilter();

      const analyser =
        context.createAnalyser();

      const robotOscillator =
        context.createOscillator();

      const robotGain =
        context.createGain();

      outputGain.gain.value = volume;

      distortionNode.curve =
        createDistortionCurve(distortion);

      distortionNode.oversample = "4x";

      delayNode.delayTime.value = 0.12;

      feedbackNode.gain.value =
        echo * 0.55;

      filterNode.type = "lowpass";
      filterNode.frequency.value = 18000;

      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;

      robotOscillator.type = "sine";
      robotOscillator.frequency.value = 30;

      robotGain.gain.value = 0;

      /*
       * Main audio chain:
       *
       * Microphone
       *     ↓
       * Filter
       *     ↓
       * Distortion
       *     ↓
       * ┌───────────────┐
       * │               │
       * ↓               ↓
       * Direct         Echo
       * │               │
       * └───────┬───────┘
       *         ↓
       *       Output
       */

      source.connect(filterNode);

      filterNode.connect(distortionNode);

      distortionNode.connect(outputGain);

      distortionNode.connect(delayNode);

      delayNode.connect(feedbackNode);

      feedbackNode.connect(delayNode);

      delayNode.connect(outputGain);

      /*
       * Robot oscillator.
       */

      robotOscillator.connect(robotGain);
      robotGain.connect(outputGain);

      /*
       * Visualizer.
       */

      outputGain.connect(analyser);

      analyser.connect(context.destination);

      robotOscillator.start();

      audioContextRef.current = context;
      streamRef.current = stream;

      sourceRef.current = source;

      outputGainRef.current = outputGain;
      distortionRef.current = distortionNode;

      delayRef.current = delayNode;
      feedbackRef.current = feedbackNode;

      filterRef.current = filterNode;

      analyserRef.current = analyser;

      robotOscillatorRef.current =
        robotOscillator;

      robotGainRef.current = robotGain;

      setRunning(true);

      startVisualizer();
    } catch (err) {
      console.error(err);

      streamRef.current
        ?.getTracks()
        .forEach((track) => track.stop());

      setError(
        "לא ניתן לגשת למיקרופון. ודא שנתת לאתר הרשאה להשתמש במיקרופון."
      );
    }
  };

  const toggleAudio = () => {
    if (running) {
      stopAudio();
    } else {
      void startAudio();
    }
  };

  useEffect(() => {
    if (!running) return;

    const context =
      audioContextRef.current;

    if (!context) return;

    const currentTime =
      context.currentTime;

    outputGainRef.current?.gain.setTargetAtTime(
      volume,
      currentTime,
      0.01
    );

    if (distortionRef.current) {
      distortionRef.current.curve =
        createDistortionCurve(distortion);
    }

    feedbackRef.current?.gain.setTargetAtTime(
      echo * 0.55,
      currentTime,
      0.01
    );

    robotGainRef.current?.gain.setTargetAtTime(
      robot,
      currentTime,
      0.01
    );

    if (filterRef.current) {
      if (activePreset === "Radio") {
        filterRef.current.type =
          "bandpass";

        filterRef.current.frequency.setTargetAtTime(
          1600,
          currentTime,
          0.01
        );

        filterRef.current.Q.setTargetAtTime(
          0.8,
          currentTime,
          0.01
        );
      } else if (activePreset === "Deep") {
        filterRef.current.type =
          "lowpass";

        filterRef.current.frequency.setTargetAtTime(
          5000,
          currentTime,
          0.01
        );
      } else if (activePreset === "High") {
        filterRef.current.type =
          "highpass";

        filterRef.current.frequency.setTargetAtTime(
          150,
          currentTime,
          0.01
        );
      } else {
        filterRef.current.type =
          "lowpass";

        filterRef.current.frequency.setTargetAtTime(
          18000,
          currentTime,
          0.01
        );

        filterRef.current.Q.setTargetAtTime(
          0,
          currentTime,
          0.01
        );
      }
    }
  }, [
    volume,
    echo,
    distortion,
    robot,
    activePreset,
    running,
  ]);

  useEffect(() => {
    return () => {
      stopVisualizer();

      streamRef.current
        ?.getTracks()
        .forEach((track) => track.stop());

      void audioContextRef.current?.close();
    };
  }, []);

  const applyPreset = (preset: Preset) => {
    setActivePreset(preset.name);

    setPitch(preset.pitch);
    setVolume(preset.volume);
    setEcho(preset.echo);
    setDistortion(preset.distortion);
    setRobot(preset.robot);
  };

  return (
    <div className="app">
      <header className="navbar">
        <div className="logo">
          <span>&lt;</span>
          Voice
          <span>/&gt;</span>
        </div>

        <div
          className={`status ${
            running ? "active" : ""
          }`}
        >
          <span />
          {running ? "LIVE" : "OFFLINE"}
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="badge">
              <span>●</span>
              REAL-TIME AUDIO
            </div>

            <h1>
              Change your
              <br />
              <strong>voice.</strong>
            </h1>

            <p>
              A browser-based real-time
              voice changer. No installation.
              Start your microphone and
              transform your voice instantly.
            </p>

            <button
              className={`start-button ${
                running ? "stop" : ""
              }`}
              onClick={toggleAudio}
            >
              <span>
                {running ? "■" : "●"}
              </span>

              {running
                ? "Stop Voice Changer"
                : "Start Voice Changer"}
            </button>

            {error && (
              <div className="error">
                {error}
              </div>
            )}
          </div>

          <div className="visualizer-card">
            <div className="visualizer-top">
              <span>MIC INPUT</span>

              <span>
                {running
                  ? "CONNECTED"
                  : "WAITING"}
              </span>
            </div>

            <div
              className={`visualizer ${
                running ? "playing" : ""
              }`}
            >
              {levels.map((level, index) => (
                <span
                  key={index}
                  style={{
                    height: `${
                      Math.max(
                        8,
                        level * 100
                      )
                    }%`,
                  }}
                />
              ))}
            </div>

            <div className="visualizer-bottom">
              <span>INPUT</span>
              <span>OUTPUT</span>
            </div>
          </div>
        </section>

        <section className="content">
          <div className="section-heading">
            <div>
              <span>01</span>
              <h2>Voice Presets</h2>
            </div>

            <p>
              Choose an effect
            </p>
          </div>

          <div className="presets">
            {presets.map((preset) => (
              <button
                key={preset.name}
                className={`preset ${
                  activePreset ===
                  preset.name
                    ? "selected"
                    : ""
                }`}
                onClick={() =>
                  applyPreset(preset)
                }
              >
                <span className="preset-emoji">
                  {preset.emoji}
                </span>

                <span>
                  {preset.name}
                </span>
              </button>
            ))}
          </div>

          <div className="section-heading controls-heading">
            <div>
              <span>02</span>
              <h2>Controls</h2>
            </div>

            <p>
              Fine tune your voice
            </p>
          </div>

          <div className="controls">
            <label className="control">
              <div>
                <span>Pitch</span>

                <strong>
                  {pitch.toFixed(2)}x
                </strong>
              </div>

              <input
                type="range"
                min="0.5"
                max="1.8"
                step="0.01"
                value={pitch}
                onChange={(event) => {
                  setPitch(
                    Number(
                      event.target.value
                    )
                  );

                  setActivePreset("");
                }}
              />
            </label>

            <label className="control">
              <div>
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
                onChange={(event) => {
                  setVolume(
                    Number(
                      event.target.value
                    )
                  );

                  setActivePreset("");
                }}
              />
            </label>

            <label className="control">
              <div>
                <span>Echo</span>

                <strong>
                  {Math.round(
                    echo * 100
                  )}
                  %
                </strong>
              </div>

              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={echo}
                onChange={(event) => {
                  setEcho(
                    Number(
                      event.target.value
                    )
                  );

                  setActivePreset("");
                }}
              />
            </label>

            <label className="control">
              <div>
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
                onChange={(event) => {
                  setDistortion(
                    Number(
                      event.target.value
                    )
                  );

                  setActivePreset("");
                }}
              />
            </label>
          </div>

          <div className="info">
            <span>⚡</span>

            <div>
              <strong>
                Runs directly in your browser
              </strong>

              <p>
                Your microphone audio is
                processed locally using the
                Web Audio API. No voice data
                is uploaded to a server.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <span>
          <b>&lt;Voice/&gt;</b>
        </span>

        <span>
          Real-time browser audio
        </span>

        <span>
          © {new Date().getFullYear()}
        </span>
      </footer>
    </div>
  );
}

export default App;
