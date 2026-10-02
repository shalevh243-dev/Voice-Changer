import { useEffect, useRef, useState } from "react";

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

const presets: Record<PresetName, Settings> = {
  Normal: {
    pitch: 0,
    distortion: 0,
    echo: 0,
    robot: 0,
    lowpass: 14000,
    highpass: 60,
    volume: 0.8
  },

  Deep: {
    pitch: -7,
    distortion: 0.08,
    echo: 0.05,
    robot: 0,
    lowpass: 6500,
    highpass: 90,
    volume: 0.8
  },

  High: {
    pitch: 7,
    distortion: 0.08,
    echo: 0.04,
    robot: 0,
    lowpass: 14000,
    highpass: 100,
    volume: 0.78
  },

  Robot: {
    pitch: -2,
    distortion: 0.4,
    echo: 0.12,
    robot: 0.9,
    lowpass: 7500,
    highpass: 120,
    volume: 0.7
  },

  Alien: {
    pitch: 8,
    distortion: 0.3,
    echo: 0.2,
    robot: 0.65,
    lowpass: 9000,
    highpass: 180,
    volume: 0.7
  },

  Radio: {
    pitch: -1,
    distortion: 0.35,
    echo: 0.08,
    robot: 0,
    lowpass: 3200,
    highpass: 500,
    volume: 0.7
  }
};

function makeDistortionCurve(amount: number): Float32Array {
  const samples = 44100;
  const curve = new Float32Array(samples);

  const drive = Math.max(0, Math.min(100, amount * 100));

  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;

    curve[i] =
      ((3 + drive) * x * 20 * Math.PI / 180) /
      (Math.PI + drive * Math.abs(x));
  }

  return curve;
}

export default function App() {
  const [running, setRunning] = useState(false);
  const [testingMic, setTestingMic] = useState(false);

  const [preset, setPreset] = useState<PresetName>("Normal");

  const [pitch, setPitch] = useState(0);
  const [distortion, setDistortion] = useState(0);
  const [echo, setEcho] = useState(0);
  const [robot, setRobot] = useState(0);
  const [volume, setVolume] = useState(0.8);

  const [micLevel, setMicLevel] = useState(0);

  const [error, setError] = useState("");

  const audioContextRef =
    useRef<AudioContext | null>(null);

  const mediaStreamRef =
    useRef<MediaStream | null>(null);

  const sourceRef =
    useRef<MediaStreamAudioSourceNode | null>(null);

  const inputGainRef =
    useRef<GainNode | null>(null);

  const outputGainRef =
    useRef<GainNode | null>(null);

  const highpassRef =
    useRef<BiquadFilterNode | null>(null);

  const lowpassRef =
    useRef<BiquadFilterNode | null>(null);

  const distortionRef =
    useRef<WaveShaperNode | null>(null);

  const delayRef =
    useRef<DelayNode | null>(null);

  const delayGainRef =
    useRef<GainNode | null>(null);

  const robotOscRef =
    useRef<OscillatorNode | null>(null);

  const robotGainRef =
    useRef<GainNode | null>(null);

  const analyserRef =
    useRef<AnalyserNode | null>(null);

  const animationRef =
    useRef<number | null>(null);

  const stopTimerRef =
    useRef<number | null>(null);

  const updateAudio = () => {
    const context = audioContextRef.current;

    if (!context) {
      return;
    }

    const now = context.currentTime;

    if (distortionRef.current) {
      distortionRef.current.curve =
        makeDistortionCurve(distortion);

      distortionRef.current.oversample = "4x";
    }

    if (outputGainRef.current) {
      outputGainRef.current.gain.setTargetAtTime(
        volume,
        now,
        0.03
      );
    }

    if (delayGainRef.current) {
      delayGainRef.current.gain.setTargetAtTime(
        echo,
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

    if (highpassRef.current) {
      const highpass =
        pitch < -3
          ? 100
          : pitch > 3
            ? 80
            : 60;

      highpassRef.current.frequency.setTargetAtTime(
        highpass,
        now,
        0.03
      );
    }

    if (lowpassRef.current) {
      const lowpass =
        pitch > 3
          ? 11000
          : pitch < -3
            ? 6500
            : 14000;

      lowpassRef.current.frequency.setTargetAtTime(
        lowpass,
        now,
        0.03
      );
    }
  };

  const startMeter = () => {
    const analyser = analyserRef.current;

    if (!analyser) {
      return;
    }

    const data = new Uint8Array(
      analyser.fftSize
    );

    const update = () => {
      analyser.getByteTimeDomainData(data);

      let sum = 0;

      for (let i = 0; i < data.length; i++) {
        const value =
          (data[i] - 128) / 128;

        sum += value * value;
      }

      const rms =
        Math.sqrt(sum / data.length);

      const level = Math.min(
        100,
        Math.round(rms * 350)
      );

      setMicLevel(level);

      animationRef.current =
        requestAnimationFrame(update);
    };

    update();
  };

  const createAudioEngine = async (
    monitor: boolean
  ) => {
    const stream =
      await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1
        }
      });

    const context =
      new AudioContext({
        latencyHint: "interactive"
      });

    if (context.state === "suspended") {
      await context.resume();
    }

    const source =
      context.createMediaStreamSource(stream);

    const inputGain =
      context.createGain();

    const highpass =
      context.createBiquadFilter();

    highpass.type = "highpass";
    highpass.frequency.value = 60;
    highpass.Q.value = 0.7;

    const distortion =
      context.createWaveShaper();

    distortion.curve =
      makeDistortionCurve(0);

    distortion.oversample = "4x";

    const lowpass =
      context.createBiquadFilter();

    lowpass.type = "lowpass";
    lowpass.frequency.value = 14000;
    lowpass.Q.value = 0.7;

    const output =
      context.createGain();

    output.gain.value = volume;

    const delay =
      context.createDelay(1);

    delay.delayTime.value = 0.12;

    const delayGain =
      context.createGain();

    delayGain.gain.value = echo;

    const robotOsc =
      context.createOscillator();

    robotOsc.type = "square";
    robotOsc.frequency.value = 30;

    const robotGain =
      context.createGain();

    robotGain.gain.value = 0;

    const analyser =
      context.createAnalyser();

    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;

    /*
     * Main audio chain:
     *
     * Microphone
     *      ↓
     * Input Gain
     *      ↓
     * High Pass
     *      ↓
     * Distortion
     *      ↓
     * Low Pass
     *      ↓
     * Output
     *      ↓
     * Speakers
     */

    source.connect(inputGain);

    inputGain.connect(highpass);

    highpass.connect(distortion);

    distortion.connect(lowpass);

    lowpass.connect(output);

    /*
     * Echo
     */

    lowpass.connect(delay);

    delay.connect(delayGain);

    delayGain.connect(output);

    /*
     * Robot oscillator
     */

    robotOsc.connect(robotGain);

    robotGain.connect(output);

    /*
     * Visualizer
     */

    output.connect(analyser);

    /*
     * This is the important part:
     *
     * The processed microphone audio
     * goes to the computer speakers/headphones.
     */

    if (monitor) {
      output.connect(context.destination);
    }

    robotOsc.start();

    audioContextRef.current =
      context;

    mediaStreamRef.current =
      stream;

    sourceRef.current =
      source;

    inputGainRef.current =
      inputGain;

    outputGainRef.current =
      output;

    highpassRef.current =
      highpass;

    lowpassRef.current =
      lowpass;

    distortionRef.current =
      distortion;

    delayRef.current =
      delay;

    delayGainRef.current =
      delayGain;

    robotOscRef.current =
      robotOsc;

    robotGainRef.current =
      robotGain;

    analyserRef.current =
      analyser;

    updateAudio();

    startMeter();
  };

  const startVoiceChanger = async () => {
    try {
      setError("");

      await createAudioEngine(true);

      setRunning(true);
      setTestingMic(false);
    } catch (err) {
      console.error(err);

      setError(
        "לא הצלחתי לגשת למיקרופון. אשר הרשאת Microphone בדפדפן."
      );

      stop();
    }
  };

  const testMicrophone = async () => {
    try {
      setError("");

      await createAudioEngine(true);

      setTestingMic(true);
      setRunning(false);

      /*
       * בדיקה של 30 שניות.
       */

      stopTimerRef.current =
        window.setTimeout(() => {
          stop();
        }, 30000);
    } catch (err) {
      console.error(err);

      setError(
        "לא הצלחתי לגשת למיקרופון. אשר הרשאת Microphone בדפדפן."
      );

      stop();
    }
  };

  const stop = () => {
    if (stopTimerRef.current) {
      window.clearTimeout(
        stopTimerRef.current
      );

      stopTimerRef.current = null;
    }

    if (animationRef.current) {
      cancelAnimationFrame(
        animationRef.current
      );

      animationRef.current = null;
    }

    if (robotOscRef.current) {
      try {
        robotOscRef.current.stop();
      } catch {
        // already stopped
      }

      robotOscRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current
        .getTracks()
        .forEach((track) => {
          track.stop();
        });

      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current
        .close()
        .catch(() => {});

      audioContextRef.current = null;
    }

    sourceRef.current = null;
    inputGainRef.current = null;
    outputGainRef.current = null;
    highpassRef.current = null;
    lowpassRef.current = null;
    distortionRef.current = null;
    delayRef.current = null;
    delayGainRef.current = null;
    robotGainRef.current = null;
    analyserRef.current = null;

    setRunning(false);
    setTestingMic(false);
    setMicLevel(0);
  };

  const applyPreset = (
    name: PresetName
  ) => {
    const value = presets[name];

    setPreset(name);

    setPitch(value.pitch);
    setDistortion(value.distortion);
    setEcho(value.echo);
    setRobot(value.robot);
    setVolume(value.volume);
  };

  useEffect(() => {
    updateAudio();
  }, [
    pitch,
    distortion,
    echo,
    robot,
    volume
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
            ● LIVE AUDIO
          </div>

          <h1>
            Voice
            <span>Changer</span>
          </h1>

          <p>
            Change your microphone voice
            directly in your browser.
          </p>
        </div>

        <div
          className={`status ${
            running || testingMic
              ? "online"
              : ""
          }`}
        >
          <span />

          {running
            ? "Voice Changer Active"
            : testingMic
              ? "Microphone Test"
              : "Ready"}
        </div>

      </section>

      <section className="visualizer-card">

        <div className="visualizer-header">

          <div>
            <h2>
              Microphone Monitor
            </h2>

            <p>
              {testingMic
                ? "You are hearing your microphone in real time."
                : "Start the microphone to hear yourself."}
            </p>
          </div>

          <div className="level-number">
            {micLevel}%
          </div>

        </div>

        <div className="meter">
          <div
            className="meter-fill"
            style={{
              width: `${micLevel}%`
            }}
          />
        </div>

      </section>

      <section className="panel">

        <div className="panel-title">
          <div>
            <h2>Voice Presets</h2>
            <p>
              Choose a starting voice
            </p>
          </div>
        </div>

        <div className="presets">

          {(
            Object.keys(
              presets
            ) as PresetName[]
          ).map((name) => (

            <button
              key={name}
              className={`preset ${
                preset === name
                  ? "active"
                  : ""
              }`}
              onClick={() =>
                applyPreset(name)
              }
            >

              <span className="preset-icon">

                {name === "Normal"
                  ? "🎙️"
                  : name === "Deep"
                    ? "🔊"
                    : name === "High"
                      ? "✨"
                      : name === "Robot"
                        ? "🤖"
                        : name === "Alien"
                          ? "👽"
                          : "📻"}

              </span>

              <span>
                {name}
              </span>

            </button>

          ))}

        </div>

      </section>

      <section className="panel">

        <div className="panel-title">

          <div>
            <h2>Voice Effects</h2>

            <p>
              Adjust the processed microphone
            </p>
          </div>

        </div>

        <div className="controls">

          <div className="control">

            <div className="control-top">

              <label>
                Pitch
              </label>

              <strong>
                {pitch > 0
                  ? `+${pitch}`
                  : pitch}
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

          </div>

          <div className="control">

            <div className="control-top">

              <label>
                Distortion
              </label>

              <strong>
                {Math.round(
                  distortion * 100
                )}%
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

          </div>

          <div className="control">

            <div className="control-top">

              <label>
                Echo
              </label>

              <strong>
                {Math.round(
                  echo * 100
                )}%
              </strong>

            </div>

            <input
              type="range"
              min="0"
              max="0.6"
              step="0.01"
              value={echo}
              onChange={(e) =>
                setEcho(
                  Number(e.target.value)
                )
              }
            />

          </div>

          <div className="control">

            <div className="control-top">

              <label>
                Robot
              </label>

              <strong>
                {Math.round(
                  robot * 100
                )}%
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

          </div>

          <div className="control">

            <div className="control-top">

              <label>
                Volume
              </label>

              <strong>
                {Math.round(
                  volume * 100
                )}%
              </strong>

            </div>

            <input
              type="range"
              min="0"
              max="1.2"
              step="0.01"
              value={volume}
              onChange={(e) =>
                setVolume(
                  Number(e.target.value)
                )
              }
            />

          </div>

        </div>

      </section>

      {error && (
        <div className="error">
          ⚠️ {error}
        </div>
      )}

      <section className="action-area">

        <button
          className="start-button"
          onClick={startVoiceChanger}
          disabled={
            running ||
            testingMic
          }
        >
          🎙️ Start Voice Changer
        </button>

        <button
          className="test-button"
          onClick={testMicrophone}
          disabled={
            running ||
            testingMic
          }
        >
          🎧 שמע את המיקרופון
        </button>

        <button
          className="stop-button"
          onClick={stop}
          disabled={
            !running &&
            !testingMic
          }
        >
          ⏹ עצור
        </button>

        <p className="headphone-note">
          🎧 מומלץ להשתמש באוזניות כדי
          למנוע feedback.
        </p>

        <p className="privacy-note">
          🔒 האודיו מעובד מקומית בדפדפן
          ואינו נשלח לשרת.
        </p>

      </section>

    </main>
  );
}
