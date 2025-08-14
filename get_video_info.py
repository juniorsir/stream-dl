import yt_dlp
import json

url = "https://xhamster43.desi/videos/i-let-my-roommate-compare-our-pussies-with-a-sex-doll-from-tantaly-xhDHCoX?utm_source=ext_shared&utm_medium=referral&utm_campaign=link"

ydl_opts = {
    'quiet': True,
    'skip_download': True,
    'no_warnings': True
}

with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    info = ydl.extract_info(url, download=False)
    duration = info.get("duration") or 0
    formats = []

    for f in info.get('formats', []):
        # Estimate size if missing
        filesize = f.get("filesize") or f.get("filesize_approx")
        if not filesize and f.get("tbr") and duration:
            # estimate size in bytes
            filesize = int((f["tbr"] * 1000 / 8) * duration)

        # Convert to MiB
        filesize_mib = round(filesize / (1024 * 1024), 2) if filesize else "N/A"

        formats.append({
            'id': f.get('format_id'),
            'ext': f.get('ext'),
            'resolution': f.get('resolution') or f.get('height'),
            'filesize_mib': f"{filesize_mib} MiB" if isinstance(filesize_mib, float) else filesize_mib,
            'tbr': f.get('tbr'),
            'protocol': f.get('protocol'),
            'vcodec': f.get('vcodec'),
            'acodec': f.get('acodec')
        })

    print(json.dumps({
        'title': info.get('title'),
        'duration': duration,
        'formats': formats
    }, indent=2))
