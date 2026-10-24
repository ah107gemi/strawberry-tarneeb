import urllib.request
import urllib.error
import sys
import os

ZIP_PATH = os.path.join(os.path.dirname(__file__), 'strawberry-tarneeb-deploy.zip')

def deploy(token=None):
    if not token and len(sys.argv) > 1:
        token = sys.argv[1]
    
    if not token:
        print("Usage: python deploy_netlify.py <YOUR_NETLIFY_PERSONAL_ACCESS_TOKEN>")
        print("Get a free token in 10 seconds at: https://app.netlify.com/user/applications#personal-access-tokens")
        return

    if not os.path.exists(ZIP_PATH):
        print(f"Error: {ZIP_PATH} not found.")
        return

    print("Deploying Strawberry Tarneeb to Netlify...")
    with open(ZIP_PATH, 'rb') as f:
        zip_bytes = f.read()

    req = urllib.request.Request(
        'https://api.netlify.com/api/v1/sites',
        data=zip_bytes,
        headers={
            'Authorization': f'Bearer {token.strip()}',
            'Content-Type': 'application/zip'
        },
        method='POST'
    )

    try:
        with urllib.request.urlopen(req) as resp:
            import json
            data = json.loads(resp.read().decode('utf-8'))
            ssl_url = data.get('ssl_url') or data.get('url')
            admin_url = data.get('admin_url')
            print("\n" + "="*60)
            print(" SUCCESS! Your app is deployed permanently online 24/7!")
            print("="*60)
            print(f" Permanent HTTPS URL : {ssl_url}")
            print(f" Admin Dashboard     : {admin_url}")
            print("="*60)
    except urllib.error.HTTPError as e:
        print(f"Deployment failed (HTTP {e.code}): {e.read().decode('utf-8')}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == '__main__':
    deploy()
