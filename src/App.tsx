import { useEffect, useRef, useState } from "react";
import { FormantCorrectionNode } from "@soundtouchjs/formant-correction-worklet";
import processorUrl from "@soundtouchjs/formant-correction-worklet/processor?url";
import "./styles.css";

type Preset = {
  name: string;
  emoji: string;
  pitch: number;
  formant: number;
  volume: number;
  echo: number;
  distortion: number;
  robot: number;
  radio: boolean;
};

const presets: Preset[] = [
  {
    name: "Normal",
    emoji: "🎙️",
    pitch: 0,
    formant: 1,
    volume: 0.8,
    echo: 0,
    distortion: 0,
    robot: 0,
    radio: false,
  },
  {
    name: "Deep",
    emoji: "👹",
    pitch: -7,
    formant: 0.75,
    volume: 0.82,
    echo: 0.05,
    distortion: 0.08,
    robot: 0,
    radio: false,
  },
  {
    name: "High",
    emoji: "🐿️",
    pitch: 7,
    formant: 0.85,
    volume: 0.75,
    echo: 0.03,
    distortion: 0,
    robot: 0,
    radio: false,
  },
  {
    name: "Robot",
    emoji: "🤖",
    pitch: -2,
    formant: 0.65,
    volume: 0.72,
    echo: 0.12,
    distortion: 0.22,
    robot: 0.85,
    radio: false,
  },
  {
    name: "Alien",
    emoji: "👽",
    pitch: 5,
    formant: 0.45,
    volume: 0.75,
    echo: 0.25,
    distortion: 0.15,
    robot: 0.5,
    radio: false,
  },
  {
    name: "Radio",
    emoji: "📻",
    pitch: -1,
    formant: 0.9,
    volume: 0.8,
    echo: 0.08,
    distortion: 0.25,
    robot: 0,
    radio: true,
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

  const [pitch, setPitch] = useState(0);
  const [formant, setFormant] = useState(1);
  const [volume, setVolume] = useState(0.8);
  const [echo, setEcho] = useState(0);
  const [distortion, setDistortion] = useState(0);
  const [robot, setRobot] = useState(0);
  const [radio, setRadio] = useState(false);

  const [activePreset, setActivePreset] = useState("Normal");
  const [error, setError] = useState("");

  const [levels, setLevels] = useState<number[]>(
    Array.from({ length: 36 }, () => 0.08)
  );

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const pitchNodeRef = useRef<FormantCorrectionNode | null>(null);

  const outputGainRef = useRef<GainNode | null>(null);
  const distortionRef = useRef<WaveShaperNode | null>(null);

  const delayRef = useRef<DelayNode | null>(null);
  const feedbackRef = useRef<GainNode | null>(null);

  const filterRef = useRef<BiquadFilterNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const robotOscillatorRef = useRef<OscillatorNode | null>(null);
  const robotGainRef = useRef<GainNode | null>(null);
  const robotDryGainRef = useRef<GainNode | null>(null);

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
        const start = Math.floor((index / 36) * data.length);

        const end = Math.max(
          start + 1,
          Math.floor(((index + 1) / 36) * data.length)
        );

        let total = 0;

        for (let i = start; i < end; i++) {
          total += data[i];
        }

        const average = total / (end - start);

        return Math.max(
          0.08,
          Math.min(1, average / 150)
        );
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

    streamRef.current
      ?.getTracks()
      .forEach((track) => track.stop());

    void audioContextRef.current?.close();

    audioContextRef.current = null;
    streamRef.current = null;

    sourceRef.current = null;
    pitchNodeRef.current = null;

    outputGainRef.current = null;
    distortionRef.current = null;

    delayRef.current = null;
    feedbackRef.current = null;

    filterRef.current = null;
    analyserRef.current = null;

    robotOscillatorRef.current = null;
    robotGainRef.current = null;
    robotDryGainRef.current = null;

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
            channelCount: 1,
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

      /*
       * Real-time pitch + formant processing.
       *
       * The package uses AudioWorklet internally.
       */
      await FormantCorrectionNode.register(
        context,
        processorUrl
      );

      const source =
        context.createMediaStreamSource(stream);

      const pitchNode =
        new FormantCorrectionNode({
          context,
          outputChannelCount: 1,
        });

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

      /*
       * Robot modulation.
       */
      const robotOscillator =
        context.createOscillator();

      const robotGain =
        context.createGain();

      const robotDryGain =
        context.createGain();

      /*
       * Initial values.
       */
      pitchNode.pitch.value = 1;
      pitchNode.pitchSemitones.value = pitch;
      pitchNode.formantStrength.value = formant;

      outputGain.gain.value = volume;

      distortionNode.curve =
        createDistortionCurve(distortion);

      distortionNode.oversample = "4x";

      delayNode.delayTime.value = 0.12;
      feedbackNode.gain.value =
        echo * 0.5;

      filterNode.type = radio
        ? "bandpass"
        : "lowpass";

      filterNode.frequency.value =
        radio ? 1700 : 18000;

      filterNode.Q.value =
        radio ? 1.1 : 0;

      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;

      /*
       * Robot oscillator.
       *
       * It controls a gain modulation signal.
       */
      robotOscillator.type = "square";
      robotOscillator.frequency.value = 32;

      robotGain.gain.value = 0;

      robotDryGain.gain.value = 1;

      /*
       * Main voice chain:
       *
       * MIC
       * ↓
       * REAL PITCH / FORMANT
       * ↓
       * DISTORTION
       * ↓
       * FILTER
       * ↓
       * OUTPUT
       */
      source.connect(pitchNode);

      pitchNode.connect(distortionNode);

      distortionNode.connect(filterNode);

      filterNode.connect(outputGain);

      /*
       * Echo feedback.
       */
      distortionNode.connect(delayNode);

      delayNode.connect(feedbackNode);

      feedbackNode.connect(delayNode);

      delayNode.connect(outputGain);

      /*
       * Robot ring-style modulation.
       *
       * The oscillator drives the gain of the
       * processed voice.
       */
      const robotModulator =
        context.createGain();

      robotModulator.gain.value = 0.5;

      robotOscillator.connect(
        robotModulator
      );

      robotModulator.connect(
        robotGain.gain
      );

      filterNode.connect(robotGain);

      robotGain.connect(outputGain);

      /*
       * Final output.
       */
      outputGain.connect(analyser);

      analyser.connect(
        context.destination
      );

      robotOscillator.start();

      audioContextRef.current = context;
      streamRef.current = stream;

      sourceRef.current = source;
      pitchNodeRef.current = pitchNode;

      outputGainRef.current =
        outputGain;

      distortionRef.current =
        distortionNode;

      delayRef.current =
        delayNode;

      feedbackRef.current =
        feedbackNode;

      filterRef.current =
        filterNode;

      analyserRef.current =
        analyser;

      robotOscillatorRef.current =
        robotOscillator;

      robotGainRef.current =
        robotGain;

      robotDryGainRef.current =
        robotDryGain;

      setRunning(true);

      startVisualizer();
    } catch (err) {
      console.error(err);

      streamRef.current
        ?.getTracks()
        .forEach((track) => track.stop());

      setError(
        "לא ניתן להפעיל את המיקרופון או את מנוע שינוי הקול. ודא שנתת הרשאת Microphone ושאתה משתמש ב-HTTPS."
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

    /*
     * Real pitch shifting.
     */
    pitchNodeRef.current?.pitchSemitones
      .setTargetAtTime(
        pitch,
        currentTime,
        0.015
      );

    /*
     * Formant preservation.
     *
     * 1 = preserve original vocal
     * timbre strongly.
     */
    pitchNodeRef.current?.formantStrength
      .setTargetAtTime(
        formant,
        currentTime,
        0.015
      );

    outputGainRef.current?.gain
      .setTargetAtTime(
        volume,
        currentTime,
        0.015
      );

    if (distortionRef.current) {
      distortionRef.current.curve =
        createDistortionCurve(
          distortion
        );
    }

    feedbackRef.current?.gain
      .setTargetAtTime(
        echo * 0.5,
        currentTime,
        0.015
      );

    /*
     * Radio mode.
     */
    if (filterRef.current) {
      if (radio) {
        filterRef.current.type =
          "bandpass";

        filterRef.current.frequency
          .setTargetAtTime(
            1700,
            currentTime,
            0.015
          );

        filterRef.current.Q
          .setTargetAtTime(
            1.1,
            currentTime,
            0.015
          );
      } else {
        filterRef.current.type =
          "lowpass";

        filterRef.current.frequency
          .setTargetAtTime(
            18000,
            currentTime,
            0.015
          );

        filterRef.current.Q
          .setTargetAtTime(
            0,
            currentTime,
            0.015
          );
      }
    }

    /*
     * Robot intensity.
     */
    if (robotGainRef.current) {
      robotGainRef.current.gain
        .setTargetAtTime(
          robot * 0.55,
          currentTime,
          0.015
        );
    }
  }, [
    running,
    pitch,
    formant,
    volume,
    echo,
    distortion,
    robot,
    radio,
  ]);

  useEffect(() => {
    return () => {
      stopVisualizer();

      streamRef.current
        ?.getTracks()
        .forEach((track) =>
          track.stop()
        );

      void audioContextRef.current?.close();
    };
  }, []);

  const applyPreset = (
    preset: Preset
  ) => {
    setActivePreset(
      preset.name
    );

    setPitch(preset.pitch);
    setFormant(preset.formant);
    setVolume(preset.volume);
    setEcho(preset.echo);
    setDistortion(
      preset.distortion
    );
    setRobot(preset.robot);
    setRadio(preset.radio);
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
          {running
            ? "LIVE"
            : "OFFLINE"}
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="badge">
              <span>●</span>
              REAL-TIME VOICE ENGINE
            </div>

            <h1>
              Change your
              <br />
              <strong>voice.</strong>
            </h1>

            <p>
              Real-time pitch shifting,
              formant processing and
              voice effects running
              locally in your browser.
            </p>

            <button
              className={`start-button ${
                running ? "stop" : ""
              }`}
              onClick={toggleAudio}
            >
              <span>
                {running
                  ? "■"
                  : "●"}
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
              <span>
                VOICE INPUT
              </span>

              <span>
                {running
                  ? "PROCESSING"
                  : "WAITING"}
              </span>
            </div>

            <div
              className={`visualizer ${
                running
                  ? "playing"
                  : ""
              }`}
            >
              {levels.map(
                (level, index) => (
                  <span
                    key={index}
                    style={{
                      height: `${Math.max(
                        8,
                        level * 100
                      )}%`,
                    }}
                  />
                )
              )}
            </div>

            <div className="visualizer-bottom">
              <span>
                INPUT
              </span>

              <span>
                OUTPUT
              </span>
            </div>
          </div>
        </section>

        <section className="content">
          <div className="section-heading">
            <div>
              <span>01</span>
              <h2>
                Voice Presets
              </h2>
            </div>

            <p>
              Choose an effect
            </p>
          </div>

          <div className="presets">
            {presets.map(
              (preset) => (
                <button
                  key={
                    preset.name
                  }
                  className={`preset ${
                    activePreset ===
                    preset.name
                      ? "selected"
                      : ""
                  }`}
                  onClick={() =>
                    applyPreset(
                      preset
                    )
                  }
                >
                  <span className="preset-emoji">
                    {
                      preset.emoji
                    }
                  </span>

                  <span>
                    {
                      preset.name
                    }
                  </span>
                </button>
              )
            )}
          </div>

          <div className="section-heading controls-heading">
            <div>
              <span>02</span>
              <h2>
                Voice Engine
              </h2>
            </div>

            <p>
              Fine tune the voice
            </p>
          </div>

          <div className="controls">
            <label className="control">
              <div>
                <span>
                  Pitch
                </span>

                <strong>
                  {pitch > 0
                    ? `+${pitch}`
                    : pitch}
                  st
                </strong>
              </div>

              <input
                type="range"
                min="-12"
                max="12"
                step="1"
                value={pitch}
                onChange={(event) => {
                  setPitch(
                    Number(
                      event.target
                        .value
                    )
                  );

                  setActivePreset(
                    ""
                  );
                }}
              />
            </label>

            <label className="control">
              <div>
                <span>
                  Formant
                </span>

                <strong>
                  {Math.round(
                    formant * 100
                  )}
                  %
                </strong>
              </div>

              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={formant}
                onChange={(event) => {
                  setFormant(
                    Number(
                      event.target
                        .value
                    )
                  );

                  setActivePreset(
                    ""
                  );
                }}
              />
            </label>

            <label className="control">
              <div>
                <span>
                  Volume
                </span>

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
                      event.target
                        .value
                    )
                  );

                  setActivePreset(
                    ""
                  );
                }}
              />
            </label>

            <label className="control">
              <div>
                <span>
                  Echo
                </span>

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
                      event.target
                        .value
                    )
                  );

                  setActivePreset(
                    ""
                  );
                }}
              />
            </label>

            <label className="control">
              <div>
                <span>
                  Distortion
                </span>

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
                value={
                  distortion
                }
                onChange={(event) => {
                  setDistortion(
                    Number(
                      event.target
                        .value
                    )
                  );

                  setActivePreset(
                    ""
                  );
                }}
              />
            </label>

            <label className="control">
              <div>
                <span>
                  Robot
                </span>

                <strong>
                  {Math.round(
                    robot * 100
                  )}
                  %
                </strong>
              </div>

              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={robot}
                onChange={(event) => {
                  setRobot(
                    Number(
                      event.target
                        .value
                    )
                  );

                  setActivePreset(
                    ""
                  );
                }}
              />
            </label>
          </div>

          <div className="radio-toggle">
            <div>
              <strong>
                Radio Mode
              </strong>

              <span>
                Telephone / radio
                frequency profile
              </span>
            </div>

            <button
              className={
                radio
                  ? "toggle on"
                  : "toggle"
              }
              onClick={() => {
                setRadio(
                  !radio
                );
                setActivePreset(
                  ""
                );
              }}
            >
              <span />
            </button>
          </div>

          <div className="info">
            <span>
              ⚡
            </span>

            <div>
              <strong>
                Local voice
                processing
              </strong>

              <p>
                Microphone audio is
                processed locally
                using Web Audio and
                AudioWorklet. No voice
                recording is uploaded
                to your server.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <span>
          <b>
            &lt;Voice/&gt;
          </b>
        </span>

        <span>
          Real-time browser
          audio
        </span>

        <span>
          ©{" "}
          {new Date().getFullYear()}
        </span>
      </footer>
    </div>
  );
}

export default App;
