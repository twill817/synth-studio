// MusicCues.cs — a no-code table of named music cues for AdaptiveMusicPlayer (Synth Studio).
//
// Fill the table in the Inspector, e.g.
//   RunStarted   → Go To Segment   "Explore"
//   EnemySpotted → Go To Segment   "Action"      (plays its entry sting first, if it has one)
//   ClockLow     → Set Intensity   1
//   Paused       → Duck            0.3
//   Resumed      → Unduck
//   RunOver      → End With Sting  "Finish"   (the loop stops at the next bar; the sting rings out)
// then fire cues by name — from game code (`cues.Trigger("RunStarted")`), or with no code at all from
// any UnityEvent in the Inspector (buttons, triggers, timelines): pick MusicCues → Trigger and type the name.
// The game decides *when*; the table decides *what the music does*, so it can be tuned without code.

using System;
using System.Collections.Generic;
using UnityEngine;

namespace SynthStudio
{
    public class MusicCues : MonoBehaviour
    {
        // New actions go at the end: scenes store the number, so reordering would change existing cues.
        public enum CueAction { GoToSegment, PlaySting, SetIntensity, Play, Stop, Duck, Unduck, EndWithSting }

        [Serializable]
        public class Cue
        {
            [Tooltip("The name game code or a UnityEvent uses, e.g. RunStarted")]
            public string name;
            public CueAction action;
            [Tooltip("Segment or sting name (Go To Segment, Play Sting, Play, End With Sting)")]
            public string target;
            [Tooltip("Intensity 0–1 (Set Intensity), loudness while ducked 0–1 (Duck), or fade seconds (Stop; End With Sting if the sting is missing)")]
            public float value = 1f;
        }

        [Tooltip("Defaults to the Adaptive Music Player on this GameObject")]
        public AdaptiveMusicPlayer player;
        public List<Cue> cues = new List<Cue>();
        [Tooltip("Log each cue to the Console — handy while wiring things up")]
        public bool logCues;

        void Reset() { player = GetComponent<AdaptiveMusicPlayer>(); }
        void Awake() { if (player == null) player = GetComponent<AdaptiveMusicPlayer>(); }

        /// <summary>Fire a cue by name. Unknown names log a warning instead of failing.</summary>
        public void Trigger(string cueName)
        {
            if (player == null) { Debug.LogWarning("[MusicCues] No Adaptive Music Player assigned.", this); return; }
            bool found = false;
            foreach (var cue in cues)
            {
                if (!string.Equals(cue.name, cueName, StringComparison.OrdinalIgnoreCase)) continue;
                found = true;
                if (logCues) Debug.Log($"[MusicCues] {cue.name}: {cue.action} {cue.target} {cue.value}", this);
                switch (cue.action)
                {
                    case CueAction.GoToSegment: player.GoToSegment(cue.target); break;
                    case CueAction.PlaySting: player.PlaySting(cue.target); break;
                    case CueAction.SetIntensity: player.SetIntensity(cue.value); break;
                    case CueAction.Play: player.Play(cue.target); break;
                    case CueAction.Stop: player.Stop(cue.value > 0f ? cue.value : 1f); break;
                    case CueAction.Duck: player.SetDucked(true, cue.value); break;
                    case CueAction.Unduck: player.SetDucked(false); break;
                    case CueAction.EndWithSting: player.EndWithSting(cue.target, cue.value > 0f ? cue.value : 1f); break;
                }
            }
            if (!found) Debug.LogWarning($"[MusicCues] No cue named \"{cueName}\".", this);
        }

        /// <summary>Set intensity directly (e.g. every frame from a danger value). 0 = base layer … 1 = all.</summary>
        public void SetIntensity(float value) { if (player != null) player.SetIntensity(value); }

#if UNITY_EDITOR
        // Flag cues whose segment/sting names aren't in the player's manifest (typos, renamed segments).
        // Unity also calls OnValidate while it loads a scene (opening the editor, leaving Play mode),
        // before the manifest can be read; checking then sees no segments and flags every cue. So the
        // check waits until loading is over and skips Play-mode changes.
        void OnValidate()
        {
            if (player == null) player = GetComponent<AdaptiveMusicPlayer>();
            if (UnityEditor.EditorApplication.isPlayingOrWillChangePlaymode) return;
            UnityEditor.EditorApplication.delayCall += () => { if (this != null) CheckCueNames(); };
        }

        void CheckCueNames()
        {
            if (UnityEditor.EditorApplication.isPlayingOrWillChangePlaymode) return;
            if (player == null || player.manifest == null) return;
            var segments = new HashSet<string>(player.SegmentNames());
            if (segments.Count == 0) return; // manifest unreadable (e.g. mid-import); nothing to check against
            var stings = new HashSet<string>(player.StingNames());
            foreach (var cue in cues)
            {
                bool needsSegment = cue.action == CueAction.GoToSegment || cue.action == CueAction.Play;
                if (needsSegment && !segments.Contains(cue.target))
                    Debug.LogWarning($"[MusicCues] Cue \"{cue.name}\": no segment \"{cue.target}\". Segments: {string.Join(", ", segments)}", this);
                bool needsSting = cue.action == CueAction.PlaySting || cue.action == CueAction.EndWithSting;
                if (needsSting && !stings.Contains(cue.target))
                    Debug.LogWarning($"[MusicCues] Cue \"{cue.name}\": no sting \"{cue.target}\". Stings: {string.Join(", ", stings)}", this);
            }
        }
#endif
    }
}
