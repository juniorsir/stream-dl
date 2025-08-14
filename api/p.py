# api/index.py - Final version with Vercel source root path resolution

from flask import Flask, request, jsonify, send_file
import yt_dlp
import requests
import os
import subprocess

app = Flask(__name__)

# --- The Definitive Path Resolution for Vercel ---
# The source root of your project on Vercel is one level above /var/task
# which is the parent of the directory containing this script.
api_dir = os.path.abspath(os.path.dirname(__file__))
project_root = os.path.dirname(api_dir) # Go up one level from 'api' directory

# Now we can reliably construct the paths to our binaries and public folder
yt_dlp_path = os.path.join(project_root, 'bin', 'yt-dlp')
ffmpeg_path = os.path.join(project_root, 'bin', 'ffmpeg')
public_dir = os.path.join(project_root, 'public')


# --- Serve the static frontend ---
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_static(path):
    if path != "" and os.path.exists(os.path.join(public_dir, path)):
        return send_file(os.path.join(public_dir, path))
    else:
        return send_file(os.path.join(public_dir, 'index.html'))

# --- API Endpoints ---
# The logic inside these endpoints is now correct because the paths are correct.

@app.route('/api/metadata', methods=['POST'])
def get_metadata():
    url = request.json.get('url')
    if not url: return jsonify({"error": "URL required"}), 400
    try:
        # For metadata, using the yt-dlp library is often more stable
        ydl_opts = {'quiet': True, 'no_playlist': True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            return jsonify({"title": info.get('title'), "thumbnail": info.get('thumbnail')})
    except Exception as e:
        return jsonify({"error": f"Failed to fetch metadata: {str(e)}"}), 500

@app.route('/api/formats', methods=['POST'])
def get_formats():
    url = request.json.get('url')
    if not url: return jsonify({"error": "URL required"}), 400
    try:
        command = [yt_dlp_path, '--list-formats', '--no-playlist', url]
        process = subprocess.run(
            command,
            capture_output=True, text=True, check=True
        )
        return jsonify({"formats_text": process.stdout})
    except subprocess.CalledProcessError as e:
        return jsonify({"error": "Failed to list formats", "details": e.stderr}), 500

@app.route('/api/get-url', methods=['POST'])
def get_direct_url():
    url = request.json.get('url')
    format_id = request.json.get('format_id')
    if not url or not format_id: return jsonify({"error": "URL and format_id required"}), 400
    try:
        ydl_opts = {
            'format': format_id,
            'quiet': True,
            'no_playlist': True,
            'ffmpeg_location': ffmpeg_path
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            return jsonify({"direct_url": info['url']})
    except Exception as e:
        return jsonify({"error": f"Failed to get direct URL: {str(e)}"}), 500

@app.route('/api/image-proxy')
def image_proxy():
    url = request.args.get('url')
    if not url: return "URL is required", 400
    try:
        response = requests.get(url, stream=True)
        response.raise_for_status()
        return response.content, response.status_code, response.headers.items()
    except requests.exceptions.RequestException as e:
        return f"Image not found: {str(e)}", 404
