"""Keep vote_totals up to date.

Runs on every vote created, changed or deleted. It recounts the votes for the
item that changed and writes the totals to vote_totals (row id = item id).
Only real votes count: one per user per item, and only votes whose row
permissions prove the voter created them.
"""
import json
import os

from appwrite.client import Client
from appwrite.exception import AppwriteException
from appwrite.query import Query
from appwrite.services.tables_db import TablesDB

DB_ID = 'public'


def _get(obj, key):
    """Field from a dict (older SDKs) or a model object, whose own columns sit under .data (newer SDKs)."""
    if isinstance(obj, dict):
        return obj.get(key)
    if hasattr(obj, key.lstrip('$')):
        return getattr(obj, key.lstrip('$'))
    data = getattr(obj, 'data', None) or {}
    return data.get(key) if isinstance(data, dict) else getattr(data, key, None)


def _body(req):
    try:
        return req.body_json or {}
    except Exception:
        try:
            return json.loads(req.body or '{}')
        except Exception:
            return {}


def count_votes(tables, target_id):
    up = down = 0
    seen = set()
    cursor = None
    while True:
        queries = [Query.equal('target_id', target_id), Query.limit(100)]
        if cursor:
            queries.append(Query.cursor_after(cursor))
        rows = _get(tables.list_rows(DB_ID, 'votes', queries), 'rows') or []
        for v in rows:
            voter = _get(v, 'user_id')
            perms = _get(v, '$permissions') or []
            if voter in seen or f'update("user:{voter}")' not in perms:
                continue
            seen.add(voter)
            if _get(v, 'direction') == 'up':
                up += 1
            else:
                down += 1
        if len(rows) < 100:
            return up, down
        cursor = _get(rows[-1], '$id')


def main(context):
    vote = _body(context.req)
    target_id, target_type = vote.get('target_id'), vote.get('target_type')
    if not target_id:
        return context.res.json({'skipped': 'no target'})

    key = context.req.headers.get('x-appwrite-key') or os.environ.get('APPWRITE_API_KEY', '')
    client = (Client().set_endpoint(os.environ['APPWRITE_FUNCTION_API_ENDPOINT'])
              .set_project(os.environ['APPWRITE_FUNCTION_PROJECT_ID']).set_key(key))
    tables = TablesDB(client)

    up, down = count_votes(tables, target_id)
    data = {'target_type': target_type, 'upvotes': up, 'downvotes': down}
    try:
        tables.upsert_row(DB_ID, 'vote_totals', target_id, data)
    except AppwriteException as e:
        context.error(f'Could not save totals for {target_id}: {e}')
        raise
    return context.res.json({'target': target_id, 'up': up, 'down': down})
