"""Log in with a username without exposing anyone's email.

The browser sends {username, password}. This function, running on Appwrite's
server, looks up the user privately, checks the password, and hands back a
one-time login token. The browser turns that into a session with
account.createSession(userId, secret). Emails never leave the server.
"""
import json
import os
import urllib.error
import urllib.request

from appwrite.client import Client
from appwrite.exception import AppwriteException
from appwrite.query import Query
from appwrite.services.tables_db import TablesDB
from appwrite.services.users import Users

DB_ID = os.environ.get('DB_ID', 'public')
PROFILES = os.environ.get('PROFILES_COLLECTION', 'profiles')


def _get(obj, key):
    """Read a field from either a dict (older SDKs) or a model object (newer SDKs)."""
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key.lstrip('$'), None)


def _body(req):
    try:
        return req.body_json or {}
    except Exception:
        try:
            return json.loads(req.body or '{}')
        except Exception:
            return {}


def _check_password(endpoint, project, email, password):
    """Create a throwaway session to verify the password. Returns (session, status)."""
    data = json.dumps({'email': email, 'password': password}).encode()
    request = urllib.request.Request(
        endpoint.rstrip('/') + '/account/sessions/email', data=data, method='POST',
        headers={'Content-Type': 'application/json', 'X-Appwrite-Project': project},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as res:
            return json.loads(res.read()), res.status
    except urllib.error.HTTPError as e:
        return None, e.code


def main(context):
    if context.req.method != 'POST':
        return context.res.json({'error': 'method_not_allowed'}, 405)

    body = _body(context.req)
    username = str(body.get('username', '')).strip()
    password = str(body.get('password', ''))
    if not username or not password:
        return context.res.json({'error': 'missing_fields'}, 400)

    endpoint = os.environ['APPWRITE_FUNCTION_API_ENDPOINT']
    project = os.environ['APPWRITE_FUNCTION_PROJECT_ID']
    key = context.req.headers.get('x-appwrite-key') or os.environ.get('APPWRITE_API_KEY', '')
    client = Client().set_endpoint(endpoint).set_project(project).set_key(key)
    users, tables = Users(client), TablesDB(client)

    # Same reply for "no such user" and "wrong password" so usernames can't be probed
    invalid = lambda: context.res.json({'error': 'invalid_credentials'}, 401)

    found = _get(tables.list_rows(DB_ID, PROFILES, [Query.equal('username', username), Query.limit(1)]), 'rows')
    if not found:
        return invalid()
    user_id = _get(found[0], '$id')   # profile id == user id

    try:
        email = _get(users.get(user_id), 'email')
    except AppwriteException:
        return invalid()
    if not email:
        return invalid()

    session, status = _check_password(endpoint, project, email, password)
    if status == 429:
        return context.res.json({'error': 'rate_limited'}, 429)
    if not session:
        return invalid()

    # Password is right: drop the throwaway session, issue a one-time token instead
    try:
        users.delete_session(user_id, session['$id'])
    except AppwriteException as e:
        context.error(f'Could not delete temporary session: {e}')
    token = users.create_token(user_id, 6, 60)
    return context.res.json({'userId': user_id, 'secret': _get(token, 'secret')})
