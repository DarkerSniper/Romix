// Romix burner helper. Compiled on first run with Windows' built-in .NET Framework
// C# compiler (csc.exe, C# 5), so nothing has to be downloaded. Talks to Romix over
// stdin/stdout, one JSON object per line.
//
// Commands (stdin):  {"id":1,"cmd":"drives"}
//                    {"id":2,"cmd":"layout","tracks":["a.pcm",...],"gapless":true}
//                    {"id":3,"cmd":"burn","drive":"<id>","tracks":[...],"gapless":true,"speed":0,"eject":true,"dryRun":false}
//                    {"id":4,"cmd":"verify","drive":"<id>","tracks":[...],"gapless":true}
//                    {"id":5,"cmd":"eject","drive":"<id>"}   {"id":6,"cmd":"erase","drive":"<id>"}
// Replies (stdout):  {"id":1,"ok":true,"result":...} | {"id":1,"ok":false,"error":"..."}
// Progress (stdout): {"id":3,"event":"progress",...}
//
// Uses Windows' own burning engine (IMAPI2) in raw disc-at-once mode, and raw CD-DA
// reads (IOCTL_CDROM_RAW_READ) for verification. Tracks are raw 16-bit little-endian
// stereo PCM at 44.1 kHz, a whole number of 2352-byte sectors.

using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

namespace Romix
{
    public static class Program
    {
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        static readonly object OutLock = new object();
        const int SectorBytes = 2352;
        const int SamplesPerSector = 588;

        [STAThread]
        public static int Main(string[] args)
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            Console.InputEncoding = new UTF8Encoding(false);
            Emit(new Dictionary<string, object> { { "event", "ready" }, { "version", 1 } });
            string line;
            while ((line = Console.In.ReadLine()) != null)
            {
                line = line.Trim().TrimStart('﻿'); // tolerate a byte-order mark on the first line
                if (line.Length == 0) continue;
                Dictionary<string, object> req = null;
                object id = null;
                try
                {
                    req = Json.Deserialize<Dictionary<string, object>>(line);
                    id = req.ContainsKey("id") ? req["id"] : null;
                    object result = Handle(req, id);
                    ReleaseStreams();
                    Emit(new Dictionary<string, object> { { "id", id }, { "ok", true }, { "result", result } });
                }
                catch (Exception ex)
                {
                    ReleaseStreams();
                    Emit(new Dictionary<string, object> { { "id", id }, { "ok", false }, { "error", Friendly(ex) } });
                }
            }
            return 0;
        }

        static void Emit(object o)
        {
            lock (OutLock)
            {
                Console.Out.WriteLine(Json.Serialize(o));
                Console.Out.Flush();
            }
        }

        static string Friendly(Exception ex)
        {
            Exception e = ex is System.Reflection.TargetInvocationException && ex.InnerException != null ? ex.InnerException : ex;
            uint hr = (uint)Marshal.GetHRForException(e);
            switch (hr)
            {
                case 0xC0AA0202: return "No disc in the drive";
                case 0xC0AA0204: return "The drive is busy. Try again in a moment.";
                case 0xC0AA0205: return "The drive is being used by another program";
                case 0xC0AA0206: return "This disc isn't supported. Use a blank CD-R or CD-RW.";
                case 0xC0AA0207: return "The disc isn't blank";
                case 0xC0AA0400: return "The burn was cancelled";
                case 0xC0AA0403: return "Couldn't read the audio files to burn";
                case 0xC0AA0002: return "The drive stopped responding during the burn";
                case 0xC0AA0703: return "The audio doesn't fit on this disc";
            }
            return e.Message;
        }

        static object Handle(Dictionary<string, object> req, object id)
        {
            string cmd = (string)req["cmd"];
            switch (cmd)
            {
                case "drives": return Drives();
                case "layout": return Layout(Strings(req["tracks"]), Bool(req, "gapless", true));
                case "burn": return Burn(req, id);
                case "verify": return Verify((string)req["drive"], Strings(req["tracks"]), Bool(req, "gapless", true), id);
                case "eject": Recorder((string)req["drive"]).EjectMedia(); return true;
                case "erase": return Erase((string)req["drive"], id);
                default: throw new Exception("Unknown command " + cmd);
            }
        }

        static bool Bool(Dictionary<string, object> r, string k, bool d) { return r.ContainsKey(k) && r[k] != null ? (bool)r[k] : d; }
        static int Int(Dictionary<string, object> r, string k, int d) { return r.ContainsKey(k) && r[k] != null ? Convert.ToInt32(r[k]) : d; }

        static List<string> Strings(object o)
        {
            var list = new List<string>();
            foreach (var x in (IEnumerable)o) list.Add((string)x);
            return list;
        }

        /* ---------------- IMAPI2 helpers (late bound) ---------------- */

        static dynamic Create(string progId) { return Activator.CreateInstance(Type.GetTypeFromProgID(progId, true)); }

        static dynamic Recorder(string uniqueId)
        {
            dynamic rec = Create("IMAPI2.MsftDiscRecorder2");
            rec.InitializeDiscRecorder(uniqueId);
            return rec;
        }

        static List<object> Drives()
        {
            var list = new List<object>();
            dynamic master = Create("IMAPI2.MsftDiscMaster2");
            if (!master.IsSupportedEnvironment) return list;
            foreach (object idObj in master)
            {
                string uid = (string)idObj;
                var d = new Dictionary<string, object>();
                try
                {
                    dynamic rec = Recorder(uid);
                    d["id"] = uid;
                    d["name"] = ((string)rec.VendorId).Trim() + " " + ((string)rec.ProductId).Trim();
                    var paths = new List<string>();
                    foreach (object p in (IEnumerable)rec.VolumePathNames) paths.Add((string)p);
                    d["path"] = paths.Count > 0 ? paths[0] : "";
                    bool writesCd = false;
                    foreach (object p in (IEnumerable)rec.SupportedProfiles) if (Convert.ToInt32(p) == 9 || Convert.ToInt32(p) == 10) writesCd = true;
                    d["writesCd"] = writesCd;
                    d["media"] = Media(rec);
                }
                catch (Exception ex) { d["id"] = uid; d["error"] = Friendly(ex); }
                list.Add(d);
            }
            return list;
        }

        static Dictionary<string, object> Media(dynamic rec)
        {
            var m = new Dictionary<string, object>();
            dynamic fmt = Create("IMAPI2.MsftDiscFormat2RawCD");
            bool supported = false;
            try { supported = fmt.IsCurrentMediaSupported(rec); } catch { }
            m["present"] = false;
            try
            {
                dynamic data = Create("IMAPI2.MsftDiscFormat2Data");
                data.Recorder = rec;
                int type = (int)data.CurrentPhysicalMediaType;
                m["present"] = type != 0;
                m["type"] = MediaName(type);
                m["blank"] = (bool)data.MediaPhysicallyBlank || (bool)data.MediaHeuristicallyBlank;
                m["erasable"] = type == 3;
            }
            catch { m["type"] = "none"; return m; }
            m["supported"] = supported;
            if (supported)
            {
                try
                {
                    fmt.Recorder = rec;
                    m["blank"] = (bool)fmt.MediaPhysicallyBlank;
                    m["lastLeadout"] = (int)fmt.LastPossibleStartOfLeadout;
                    var speeds = new List<int>();
                    foreach (object s in (IEnumerable)fmt.SupportedWriteSpeeds) speeds.Add(Convert.ToInt32(s));
                    m["speeds"] = speeds; // sectors per second; 75 = 1x
                }
                catch { }
            }
            return m;
        }

        static string MediaName(int t)
        {
            switch (t)
            {
                case 0: return "none";
                case 1: return "CD-ROM";
                case 2: return "CD-R";
                case 3: return "CD-RW";
                default: return t >= 4 && t <= 20 ? "DVD" : "other";
            }
        }

        /* ---------------- streams ---------------- */

        [DllImport("shlwapi.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
        static extern void SHCreateStreamOnFileEx(string file, uint mode, uint attrs, bool create, IStream template, out IStream stream);

        static readonly List<IStream> OpenStreams = new List<IStream>();

        /// Closes every file the engine opened, so Romix can delete its temporary burn files.
        static void ReleaseStreams()
        {
            foreach (var s in OpenStreams) { try { Marshal.FinalReleaseComObject(s); } catch { } }
            OpenStreams.Clear();
            GC.Collect();
            GC.WaitForPendingFinalizers();
            GC.Collect();
        }

        static IStream OpenStream(string path)
        {
            long len = new FileInfo(path).Length;
            if (len == 0 || len % SectorBytes != 0) throw new Exception("Track file isn't a whole number of CD sectors: " + Path.GetFileName(path));
            if (len < 300L * SectorBytes) throw new Exception("Tracks must be at least 4 seconds long: " + Path.GetFileName(path));
            IStream s;
            SHCreateStreamOnFileEx(path, 0x00000020 /* STGM_READ | STGM_SHARE_DENY_WRITE */, 0, false, null, out s);
            OpenStreams.Add(s);
            return s;
        }

        /// Builds the raw disc image exactly as it will be written (no drive needed).
        static dynamic BuildImage(List<string> tracks, bool gapless, int sectorType)
        {
            dynamic img = Create("IMAPI2.MsftRawCDImageCreator");
            img.ResultingImageType = sectorType;
            img.DisableGaplessAudio = !gapless; // false: tracks butt up; true: standard 2 s pregaps
            foreach (string t in tracks) img.AddTrack(0 /* IMAPI_CD_SECTOR_AUDIO */, OpenStream(t));
            return img;
        }

        static Dictionary<string, object> Layout(List<string> tracks, bool gapless)
        {
            dynamic img = BuildImage(tracks, gapless, 3);
            img.CreateResultImage();
            var t = new List<object>();
            for (int i = 1; i <= (int)img.NumberOfExistingTracks; i++)
            {
                dynamic info = img.TrackInfo(i);
                t.Add(new Dictionary<string, object> { { "number", (int)info.TrackNumber }, { "startLba", (int)info.StartingLba }, { "sectors", (int)info.SectorCount } });
            }
            return new Dictionary<string, object> { { "tracks", t }, { "leadout", (int)img.StartOfLeadout } };
        }

        /* ---------------- burn ---------------- */

        static object Burn(Dictionary<string, object> req, object id)
        {
            string drive = (string)req["drive"];
            List<string> tracks = Strings(req["tracks"]);
            bool gapless = Bool(req, "gapless", true);
            bool dryRun = Bool(req, "dryRun", false);
            bool eject = Bool(req, "eject", true);
            int speed = Int(req, "speed", 0);

            dynamic rec = Recorder(drive);
            dynamic fmt = Create("IMAPI2.MsftDiscFormat2RawCD");
            if (!(bool)fmt.IsRecorderSupported(rec)) throw new Exception("This drive can't write audio CDs in one pass");
            if (!(bool)fmt.IsCurrentMediaSupported(rec)) throw new Exception("Insert a blank CD-R or CD-RW");
            fmt.Recorder = rec;
            fmt.ClientName = "Romix";
            if (!(bool)fmt.MediaPhysicallyBlank) throw new Exception("The disc isn't blank");

            // Prefer raw subcode (most exact), else P/Q only.
            int sectorType = 0;
            foreach (object s in (IEnumerable)fmt.SupportedSectorTypes) { int v = Convert.ToInt32(s); if (v == 3 || (v == 2 && sectorType != 3)) sectorType = v; }
            if (sectorType == 0) throw new Exception("This drive doesn't support writing audio in one pass");
            fmt.RequestedSectorType = sectorType;

            dynamic img = BuildImage(tracks, gapless, sectorType);
            object stream = img.CreateResultImage();
            int leadout = (int)img.StartOfLeadout;
            int limit = (int)fmt.LastPossibleStartOfLeadout;
            if (leadout > limit) throw new Exception("The audio is " + ((leadout - limit) / 75) + " seconds too long for this disc");

            var result = new Dictionary<string, object> { { "leadout", leadout }, { "limit", limit }, { "sectorType", sectorType } };
            if (dryRun) return result;

            fmt.SetWriteSpeed(speed > 0 ? speed : -1, false); // -1 = drive maximum
            result["speed"] = (int)fmt.CurrentWriteSpeed;

            bool events = false;
            try
            {
                fmt.Update += new Action<object, object>(delegate (object sender, object args)
                {
                    try
                    {
                        dynamic a = args;
                        Emit(new Dictionary<string, object> {
                            { "id", id }, { "event", "progress" }, { "phase", "burn" },
                            { "action", (int)a.CurrentAction }, { "lba", (int)a.LastWrittenLba }, { "start", (int)a.StartLba },
                            { "count", (int)a.SectorCount }, { "elapsed", (int)a.ElapsedTime }, { "remaining", (int)a.RemainingTime } });
                    }
                    catch { }
                });
                events = true;
            }
            catch { }
            result["events"] = events;

            rec.AcquireExclusiveAccess(true, "Romix");
            try
            {
                rec.DisableMcn();
                Emit(new Dictionary<string, object> { { "id", id }, { "event", "progress" }, { "phase", "prepare" } });
                fmt.PrepareMedia();
                fmt.WriteMedia(stream);
                Emit(new Dictionary<string, object> { { "id", id }, { "event", "progress" }, { "phase", "finish" } });
                fmt.ReleaseMedia();
            }
            finally
            {
                try { rec.EnableMcn(); } catch { }
                try { rec.ReleaseExclusiveAccess(); } catch { }
            }
            if (eject) { try { rec.EjectMedia(); } catch { } }
            return result;
        }

        static object Erase(string drive, object id)
        {
            dynamic rec = Recorder(drive);
            dynamic er = Create("IMAPI2.MsftDiscFormat2Erase");
            if (!(bool)er.IsCurrentMediaSupported(rec)) throw new Exception("Only CD-RW discs can be erased");
            er.Recorder = rec;
            er.ClientName = "Romix";
            er.FullErase = false;
            try
            {
                er.Update += new Action<object, object, object>(delegate (object s, object elapsed, object total)
                {
                    Emit(new Dictionary<string, object> { { "id", id }, { "event", "progress" }, { "phase", "erase" }, { "elapsed", Convert.ToInt32(elapsed) }, { "total", Convert.ToInt32(total) } });
                });
            }
            catch { }
            rec.AcquireExclusiveAccess(true, "Romix");
            try { er.EraseMedia(); }
            finally { try { rec.ReleaseExclusiveAccess(); } catch { } }
            return true;
        }

        /* ---------------- verify: raw CD-DA read-back ---------------- */

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr tmpl);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool DeviceIoControl(SafeFileHandle h, uint code, byte[] inBuf, int inSize, byte[] outBuf, int outSize, out int returned, IntPtr ov);

        const uint IOCTL_CDROM_READ_TOC = 0x00024000;
        const uint IOCTL_CDROM_RAW_READ = 0x0002403E;
        const int ReadChunk = 26; // sectors per raw read (under the 64 KB transfer limit)

        static SafeFileHandle OpenDevice(string drivePath)
        {
            string letter = drivePath.TrimEnd('\\').TrimEnd(':');
            var h = CreateFile("\\\\.\\" + letter + ":", 0x80000000 /* GENERIC_READ */, 3, IntPtr.Zero, 3 /* OPEN_EXISTING */, 0, IntPtr.Zero);
            if (h.IsInvalid) throw new Exception("Couldn't open the drive to check the disc");
            return h;
        }

        /// Returns [firstTrackLba..., leadoutLba] from the disc's table of contents.
        static List<int> ReadToc(SafeFileHandle h)
        {
            byte[] buf = new byte[804];
            int got;
            if (!DeviceIoControl(h, IOCTL_CDROM_READ_TOC, null, 0, buf, buf.Length, out got, IntPtr.Zero)) throw new Exception("Couldn't read the disc's track list");
            int first = buf[2], last = buf[3];
            var lbas = new List<int>();
            for (int i = 0; i <= last - first + 1; i++)
            {
                int o = 4 + i * 8;
                int m = buf[o + 5], s = buf[o + 6], f = buf[o + 7];
                lbas.Add((m * 60 + s) * 75 + f - 150);
            }
            return lbas;
        }

        static bool RawRead(SafeFileHandle h, int lba, int count, byte[] outBuf)
        {
            byte[] info = new byte[16];
            BitConverter.GetBytes((long)lba * 2048).CopyTo(info, 0);
            BitConverter.GetBytes(count).CopyTo(info, 8);
            BitConverter.GetBytes(2).CopyTo(info, 12); // CDDA
            int got;
            for (int attempt = 0; attempt < 3; attempt++)
                if (DeviceIoControl(h, IOCTL_CDROM_RAW_READ, info, 16, outBuf, count * SectorBytes, out got, IntPtr.Zero) && got == count * SectorBytes) return true;
            return false;
        }

        /// The audio Romix intended to write, addressable by absolute disc sample.
        class Expected
        {
            readonly List<string> files = new List<string>();
            readonly List<long> starts = new List<long>(), lengths = new List<long>();
            public readonly long Total;
            public Expected(List<string> tracks, List<int> tocLbas)
            {
                for (int i = 0; i < tracks.Count; i++)
                {
                    files.Add(tracks[i]);
                    starts.Add((long)tocLbas[i] * SamplesPerSector);
                    lengths.Add(new FileInfo(tracks[i]).Length / 4);
                }
                Total = (long)tocLbas[tocLbas.Count - 1] * SamplesPerSector;
            }
            public int TrackAt(long sample)
            {
                for (int i = files.Count - 1; i >= 0; i--) if (sample >= starts[i]) return i;
                return 0;
            }
            /// Fills 'dst' (stereo frames as 4 bytes each) from absolute sample 'from'; gaps are silence.
            public void Read(long from, byte[] dst, int frames)
            {
                Array.Clear(dst, 0, frames * 4);
                for (int i = 0; i < files.Count; i++)
                {
                    long a = Math.Max(from, starts[i]), b = Math.Min(from + frames, starts[i] + lengths[i]);
                    if (b <= a) continue;
                    using (var fs = new FileStream(files[i], FileMode.Open, FileAccess.Read, FileShare.Read))
                    {
                        fs.Position = (a - starts[i]) * 4;
                        int need = (int)((b - a) * 4), off = (int)((a - from) * 4), r;
                        while (need > 0 && (r = fs.Read(dst, off, need)) > 0) { off += r; need -= r; }
                    }
                }
            }
        }

        static object Verify(string drive, List<string> tracks, bool gapless, object id)
        {
            dynamic rec = Recorder(drive);
            string path = "";
            foreach (object p in (IEnumerable)rec.VolumePathNames) { path = (string)p; break; }
            if (path == "") throw new Exception("The drive has no letter, so the disc can't be checked");

            using (var h = OpenDevice(path))
            {
                List<int> toc = ReadToc(h);
                if (toc.Count - 1 != tracks.Count) throw new Exception("The disc has " + (toc.Count - 1) + " tracks but " + tracks.Count + " were written");
                var exp = new Expected(tracks, toc);
                int leadout = toc[toc.Count - 1];

                // Find the combined write+read offset of this drive by matching a stretch of real audio.
                int offset = FindOffset(h, exp, toc);
                int maxShift = Math.Abs(offset) / SamplesPerSector + 2;

                var mismatches = new long[tracks.Count];
                var readErrors = new int[tracks.Count];
                byte[] disc = new byte[ReadChunk * SectorBytes];
                byte[] want = new byte[ReadChunk * SectorBytes];
                int lastPct = -1;
                for (int lba = maxShift; lba < leadout - maxShift; lba += ReadChunk)
                {
                    int n = Math.Min(ReadChunk, leadout - maxShift - lba);
                    long fromSample = (long)lba * SamplesPerSector;
                    int ti = exp.TrackAt(fromSample);
                    if (!RawRead(h, lba, n, disc)) { readErrors[ti] += n; continue; }
                    exp.Read(fromSample + offset, want, n * SamplesPerSector);
                    for (int i = 0; i < n * SectorBytes; i += 4)
                        if (disc[i] != want[i] || disc[i + 1] != want[i + 1] || disc[i + 2] != want[i + 2] || disc[i + 3] != want[i + 3])
                            mismatches[exp.TrackAt(fromSample + i / 4)]++;
                    int pct = (int)(100L * lba / leadout);
                    if (pct != lastPct) { lastPct = pct; Emit(new Dictionary<string, object> { { "id", id }, { "event", "progress" }, { "phase", "verify" }, { "percent", pct } }); }
                }

                var per = new List<object>();
                for (int i = 0; i < tracks.Count; i++)
                    per.Add(new Dictionary<string, object> { { "track", i + 1 }, { "ok", mismatches[i] == 0 && readErrors[i] == 0 }, { "differentSamples", mismatches[i] }, { "unreadableSectors", readErrors[i] } });
                return new Dictionary<string, object> { { "offset", offset }, { "tracks", per } };
            }
        }

        /// Searches ±5 sectors for the shift that makes the disc match the expected audio exactly.
        static int FindOffset(SafeFileHandle h, Expected exp, List<int> toc)
        {
            const int range = 5 * SamplesPerSector;
            // Probe in the middle of the longest track, where there is real music.
            int best = 0;
            long bestLen = -1;
            for (int i = 0; i < toc.Count - 1; i++) if (toc[i + 1] - toc[i] > bestLen) { bestLen = toc[i + 1] - toc[i]; best = i; }
            int probeLba = toc[best] + (int)(bestLen / 2);
            int sectors = 4;
            byte[] disc = new byte[sectors * SectorBytes];
            if (!RawRead(h, probeLba, sectors, disc)) throw new Exception("Couldn't read the disc to check it");
            int frames = sectors * SamplesPerSector;
            byte[] want = new byte[(frames + 2 * range) * 4];
            exp.Read((long)probeLba * SamplesPerSector - range, want, frames + 2 * range);
            for (int d = 0; d <= range; d++)
                foreach (int s in new[] { d, -d })
                {
                    int baseIdx = (range + s) * 4;
                    bool ok = true;
                    for (int i = 0; i < frames * 4 && ok; i++) if (disc[i] != want[baseIdx + i]) ok = false;
                    if (ok) return s;
                }
            throw new Exception("The disc's audio doesn't match what was written");
        }
    }
}
