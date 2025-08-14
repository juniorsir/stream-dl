import sys
import json
import yt_dlp

def get_metadata(url):
    try:
        ydl_opts = {
            'quiet': True,
            'no_playlist': True,
            'dumpjson': True  # Output as a single JSON line
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # We don't use extract_info here, as that can be slow.
            # We prepare the request and then process it to get the raw JSON.
            info = ydl.sanitize_info(ydl.extract_info(url, download=False))
            # Print the final JSON to standard output
            print(json.dumps(info))
    except Exception as e:
        # Print error to standard error
        print(f"Python Error: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    # The script expects the URL as the first command-line argument
    video_url = sys.argv[1]
    get_metadata(video_url)
