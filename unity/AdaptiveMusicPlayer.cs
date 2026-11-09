// AdaptiveMusicPlayer.cs — plays adaptive music exported from Synth Studio ("Export → Unity adaptive package").
//
// Setup (once per score / level):
//   1. Copy the exported score folder (manifest.json + WAVs) into your Unity project's Assets.
//   2. Add this component to a GameObject in the level.
//   3. Drag manifest.json into "Manifest" and all of that folder's WAVs into "Clips".
//
// From game code:
//   music.GoToSegment("Action");   // switches on the next beat / bar / segment end (as set in Synth Studio)
//   music.SetIntensity(0.75f);     // 0 = base layer only … 1 = every layer
//   music.PlaySting("Alert");      // one-shot, then back to the current segment
//   music.Stop(2f);                // fade out over 2 seconds
//
// Timing is sample-accurate: everything is scheduled on the audio clock (AudioSettings.dspTime).

using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using UnityEngine.Audio;

namespace SynthStudio
{
    [Serializable] public class MusicLayer { public string name; }

    [Serializable] public class MusicSegment
    {
        public string name;
        public int bars;
        public int lengthSamples;
        public string entrySting;   // "" = none
        public string[] stems;      // one file per layer, "" = silent layer
    }

    [Serializable] public class MusicSting
    {
        public string name;
        public int bars;
        public int musicalLengthSamples; // where the next segment starts
        public int lengthSamples;        // including the ringing tail
        public string file;
    }

    [Serializable] public class MusicManifest
    {
        public string format;
        public int version;
        public string game;
        public string score;
        public float bpm;
        public int beatsPerBar;
        public int sampleRate;
        public string quantize;          // "beat" | "bar" | "end"
        public string startSegment;
        public MusicLayer[] layers;
        public MusicSegment[] segments;
        public MusicSting[] stings;
    }

    public class AdaptiveMusicPlayer : MonoBehaviour
    {
        [Tooltip("manifest.json from the Synth Studio export")]
        public TextAsset manifest;
        [Tooltip("All WAV files from the same export folder")]
        public AudioClip[] clips;
        [Tooltip("Optional mixer group for the music")]
        public AudioMixerGroup output;

        [Range(0f, 1f)] public float intensity = 1f;
        [Range(0f, 1f)] public float volume = 1f;
        [Tooltip("Seconds for a layer to fade fully in or out when intensity changes")]
        public float layerFadeTime = 1.5f;
        public bool playOnStart = true;
        [Tooltip("Show on-screen buttons in Play mode to try segments, stings and intensity. Turn off for the real game.")]
        public bool showTestControls = true;

        /// <summary>Name of the segment that is playing (or about to start).</summary>
        public string CurrentSegment => current != null ? current.name : null;

        MusicManifest m;
        readonly Dictionary<string, AudioClip> clipByName = new Dictionary<string, AudioClip>();
        AudioSource[][] banks;          // two banks of one source per layer, swapped at each segment change
        AudioSource[] stingSources;     // two, so a sting's tail can ring under the next one
        int activeBank = -1, nextSting;
        float[] layerLevel;
        float master = 1f;

        MusicSegment current;
        double segmentStart;            // dspTime the current segment's loop started (may be in the future)
        string queuedSegment, queuedSting;
        bool queuedHasRequest;
        Coroutine fade;

        const double ScheduleLead = 0.06; // seconds ahead we need to schedule safely

        void Awake()
        {
            if (manifest == null) { Debug.LogError("[AdaptiveMusicPlayer] No manifest assigned.", this); enabled = false; return; }
            m = JsonUtility.FromJson<MusicManifest>(manifest.text);
            foreach (var c in clips)
            {
                if (c == null) continue;
                clipByName[c.name] = c;
                if (c.loadState != AudioDataLoadState.Loaded) c.LoadAudioData();
            }
            int n = m.layers.Length;
            layerLevel = new float[n];
            for (int i = 0; i < n; i++) layerLevel[i] = TargetLevel(i);
            banks = new AudioSource[2][];
            for (int b = 0; b < 2; b++)
            {
                banks[b] = new AudioSource[n];
                for (int i = 0; i < n; i++) banks[b][i] = MakeSource(true);
            }
            stingSources = new[] { MakeSource(false), MakeSource(false) };
        }

        void Start()
        {
            if (playOnStart && m != null) Play(m.startSegment);
        }

        AudioSource MakeSource(bool loop)
        {
            var s = gameObject.AddComponent<AudioSource>();
            s.playOnAwake = false;
            s.loop = loop;
            s.spatialBlend = 0f;
            s.outputAudioMixerGroup = output;
            return s;
        }

        // ---------------------------------------------------------------- public API

        /// <summary>Start a segment right away (stops whatever is playing).</summary>
        public void Play(string segment)
        {
            var seg = FindSegment(segment);
            if (seg == null) return;
            if (fade != null) { StopCoroutine(fade); fade = null; }
            master = 1f;
            double t = AudioSettings.dspTime + ScheduleLead;
            StopAllAt(t);
            StartSegmentAt(seg, t, t);
        }

        /// <summary>Move to another segment at the next quantize point, through its entry sting if it has one.</summary>
        public void GoToSegment(string segment) => Request(segment, null);

        /// <summary>Play a sting at the next quantize point, then restart the current segment.</summary>
        public void PlaySting(string sting) { if (current != null) Request(current.name, sting); }

        public void SetIntensity(float value) => intensity = Mathf.Clamp01(value);

        public void Stop(float fadeSeconds = 1f)
        {
            if (fade != null) StopCoroutine(fade);
            fade = StartCoroutine(FadeOut(fadeSeconds));
        }

        // ---------------------------------------------------------------- scheduling

        void Request(string segment, string stingOverride)
        {
            var seg = FindSegment(segment);
            if (seg == null) return;
            if (current == null) { Play(segment); return; }
            // A change is already scheduled but hasn't started yet: apply this one once it has.
            if (AudioSettings.dspTime < segmentStart)
            {
                queuedSegment = segment; queuedSting = stingOverride; queuedHasRequest = true;
                return;
            }
            if (stingOverride == null && seg == current) return;

            double now = AudioSettings.dspTime + ScheduleLead;
            double q = QuantizeSeconds();
            double boundary = segmentStart + Math.Ceiling((now - segmentStart) / q) * q;
            double start = boundary;

            // The current segment stops at the boundary; a sting (if any) fills the gap before the new one.
            string stingName = stingOverride ?? seg.entrySting;
            var sting = string.IsNullOrEmpty(stingName) ? null : FindSting(stingName);
            if (sting != null)
            {
                var src = stingSources[nextSting]; nextSting = 1 - nextSting;
                src.clip = Clip(sting.file);
                src.volume = volume * master;
                if (src.clip != null) src.PlayScheduled(boundary);
                start += sting.musicalLengthSamples / (double)m.sampleRate;
            }
            StartSegmentAt(seg, start, boundary);
        }

        double QuantizeSeconds()
        {
            double beat = 60.0 / m.bpm;
            switch (m.quantize)
            {
                case "beat": return beat;
                case "end": return current.lengthSamples / (double)m.sampleRate;
                default: return beat * Math.Max(1, m.beatsPerBar);
            }
        }

        // Start `seg` on the free bank at dspTime t; the playing bank stops at stopOldAt (≤ t).
        void StartSegmentAt(MusicSegment seg, double t, double stopOldAt)
        {
            int next = activeBank < 0 ? 0 : 1 - activeBank;
            if (activeBank >= 0)
                foreach (var s in banks[activeBank]) if (s.isPlaying) s.SetScheduledEndTime(stopOldAt);
            for (int i = 0; i < banks[next].Length; i++)
            {
                var s = banks[next][i];
                s.Stop();
                s.clip = i < seg.stems.Length ? Clip(seg.stems[i]) : null;
                s.volume = layerLevel[i] * volume * master;
                if (s.clip != null) s.PlayScheduled(t);
            }
            activeBank = next;
            current = seg;
            segmentStart = t;
        }

        void StopAllAt(double t)
        {
            if (banks == null) return;
            foreach (var bank in banks)
                foreach (var s in bank) if (s.isPlaying) s.SetScheduledEndTime(t);
        }

        // ---------------------------------------------------------------- per frame

        void Update()
        {
            if (m == null) return;
            float step = layerFadeTime > 0f ? Time.unscaledDeltaTime / layerFadeTime : 1f;
            for (int i = 0; i < layerLevel.Length; i++)
            {
                layerLevel[i] = Mathf.MoveTowards(layerLevel[i], TargetLevel(i), step);
                float v = layerLevel[i] * volume * master;
                banks[0][i].volume = v;
                banks[1][i].volume = v;
            }
            if (queuedHasRequest && AudioSettings.dspTime >= segmentStart)
            {
                queuedHasRequest = false;
                Request(queuedSegment, queuedSting);
            }
        }

        // Base layer is always on; layer i fades in across its slice of the intensity range.
        float TargetLevel(int i)
        {
            int n = m.layers.Length;
            if (i == 0 || n < 2) return 1f;
            return Mathf.Clamp01(intensity * (n - 1) - (i - 1));
        }

        IEnumerator FadeOut(float seconds)
        {
            float start = master;
            for (float t = 0f; t < seconds; t += Time.unscaledDeltaTime)
            {
                master = Mathf.Lerp(start, 0f, t / seconds);
                foreach (var s in stingSources) s.volume = volume * master;
                yield return null;
            }
            master = 0f;
            foreach (var bank in banks) foreach (var s in bank) s.Stop();
            foreach (var s in stingSources) s.Stop();
            current = null;
            activeBank = -1;
            fade = null;
        }

        // ---------------------------------------------------------------- test panel

        void OnGUI()
        {
            if (!showTestControls || m == null) return;
            GUILayout.BeginArea(new Rect(10, 10, 240, Screen.height - 20), GUI.skin.box);
            GUILayout.Label(m.score + "  —  " + (current != null ? "playing " + current.name : "stopped"));
            GUILayout.Space(6);
            GUILayout.Label("Segments");
            foreach (var s in m.segments)
                if (GUILayout.Button(s.name + (string.IsNullOrEmpty(s.entrySting) ? "" : "  (via " + s.entrySting + ")"))) GoToSegment(s.name);
            if (m.stings != null && m.stings.Length > 0)
            {
                GUILayout.Space(6);
                GUILayout.Label("Stings");
                foreach (var s in m.stings) if (GUILayout.Button(s.name)) PlaySting(s.name);
            }
            GUILayout.Space(6);
            GUILayout.Label("Intensity " + Mathf.RoundToInt(intensity * 100) + "%");
            intensity = GUILayout.HorizontalSlider(intensity, 0f, 1f);
            GUILayout.Space(10);
            if (GUILayout.Button("Stop (fade out)")) Stop(1.5f);
            GUILayout.EndArea();
        }

        // ---------------------------------------------------------------- lookups

        MusicSegment FindSegment(string name)
        {
            foreach (var s in m.segments) if (s.name == name) return s;
            Debug.LogWarning($"[AdaptiveMusicPlayer] No segment named \"{name}\" in {m.score}.", this);
            return null;
        }

        MusicSting FindSting(string name)
        {
            foreach (var s in m.stings) if (s.name == name) return s;
            Debug.LogWarning($"[AdaptiveMusicPlayer] No sting named \"{name}\" in {m.score}.", this);
            return null;
        }

        AudioClip Clip(string file)
        {
            if (string.IsNullOrEmpty(file)) return null;
            if (clipByName.TryGetValue(Path.GetFileNameWithoutExtension(file), out var c)) return c;
            Debug.LogWarning($"[AdaptiveMusicPlayer] Clip \"{file}\" is missing from Clips.", this);
            return null;
        }
    }
}
