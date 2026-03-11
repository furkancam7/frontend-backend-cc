import sqlite3
import threading
import atexit
from datetime import datetime
from typing import Dict, List, Optional, Any
from contextlib import contextmanager
import os
import logging

logger = logging.getLogger(__name__)

DB_DIR = os.path.dirname(__file__)
DB_PATH = os.path.join(DB_DIR, "active_transfers.db")

def _cleanup_wal_files():
    try:
        if os.path.exists(DB_PATH):
            conn = sqlite3.connect(DB_PATH, timeout=5.0)
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            conn.close()
            logger.info("WAL checkpoint completed on exit")
    except Exception as e:
        logger.warning(f"WAL cleanup on exit failed: {e}")

atexit.register(_cleanup_wal_files)

class TransferStateDB:
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        
        self._local = threading.local()
        self._init_db()
        self._initialized = True
        logger.info(f"TransferStateDB initialized at {DB_PATH}")
    
    def _get_connection(self) -> sqlite3.Connection:
        if not hasattr(self._local, 'connection') or self._local.connection is None:
            self._local.connection = sqlite3.connect(
                DB_PATH,
                check_same_thread=False,
                timeout=30.0
            )
            self._local.connection.row_factory = sqlite3.Row
            self._local.connection.execute("PRAGMA journal_mode=WAL")
            self._local.connection.execute("PRAGMA synchronous=NORMAL")
        return self._local.connection
    
    @contextmanager
    def _transaction(self):
        conn = self._get_connection()
        try:
            yield conn
            conn.commit()
        except Exception as e:
            conn.rollback()
            logger.error(f"Transaction failed: {e}")
            raise
    
    def _init_db(self):
        conn = sqlite3.connect(DB_PATH, timeout=30.0)
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS active_transfers (
                    transfer_id TEXT PRIMARY KEY,
                    filename TEXT NOT NULL,
                    chunk_total INTEGER NOT NULL,
                    chunks_received INTEGER DEFAULT 0,
                    started_at TEXT NOT NULL,
                    last_activity TEXT,
                    record_id TEXT,
                    hub_id TEXT,
                    solo_id TEXT,
                    metadata TEXT,
                    status TEXT DEFAULT 'receiving',
                    partial_path TEXT,
                    partial_percent REAL DEFAULT 0
                )
            """)
            try:
                conn.execute("ALTER TABLE active_transfers ADD COLUMN partial_path TEXT")
            except sqlite3.OperationalError:
                pass 
            try:
                conn.execute("ALTER TABLE active_transfers ADD COLUMN partial_percent REAL DEFAULT 0")
            except sqlite3.OperationalError:
                pass  
            
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_transfers_status 
                ON active_transfers(status)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_transfers_record_id 
                ON active_transfers(record_id)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_transfers_started_at 
                ON active_transfers(started_at)
            """)
            
            conn.commit()
            logger.info("Transfer state database schema initialized")
        finally:
            conn.close()
    
    def register_transfer(
        self,
        transfer_id: str,
        filename: str,
        chunk_total: int,
        record_id: Optional[str] = None,
        hub_id: Optional[str] = None,
        solo_id: Optional[str] = None,
        metadata: Optional[Dict] = None
    ) -> bool:
        import json
        now = datetime.now().isoformat()
        metadata_json = json.dumps(metadata) if metadata else None
        
        with self._transaction() as conn:
            cursor = conn.execute(
                "SELECT transfer_id FROM active_transfers WHERE transfer_id = ?",
                (transfer_id,)
            )
            exists = cursor.fetchone() is not None
            
            if exists:
                conn.execute("""
                    UPDATE active_transfers 
                    SET last_activity = ?, metadata = COALESCE(?, metadata)
                    WHERE transfer_id = ?
                """, (now, metadata_json, transfer_id))
                return False
            else:
                conn.execute("""
                    INSERT INTO active_transfers 
                    (transfer_id, filename, chunk_total, chunks_received, started_at, 
                     last_activity, record_id, hub_id, solo_id, metadata, status)
                    VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'receiving')
                """, (transfer_id, filename, chunk_total, now, now, 
                      record_id, hub_id, solo_id, metadata_json))
                return True
    
    def update_chunk_count(self, transfer_id: str, chunks_received: int) -> bool:
        now = datetime.now().isoformat()
        
        with self._transaction() as conn:
            cursor = conn.execute("""
                UPDATE active_transfers 
                SET chunks_received = ?, last_activity = ?
                WHERE transfer_id = ?
            """, (chunks_received, now, transfer_id))
            return cursor.rowcount > 0
    
    def increment_chunk_count(self, transfer_id: str) -> int:
        now = datetime.now().isoformat()
        
        with self._transaction() as conn:
            conn.execute("""
                UPDATE active_transfers 
                SET chunks_received = chunks_received + 1, last_activity = ?
                WHERE transfer_id = ?
            """, (now, transfer_id))
            
            cursor = conn.execute(
                "SELECT chunks_received FROM active_transfers WHERE transfer_id = ?",
                (transfer_id,)
            )
            row = cursor.fetchone()
            return row['chunks_received'] if row else 0
    
    def complete_transfer(self, transfer_id: str) -> bool:
        """Mark a transfer as completed and remove from active list."""
        with self._transaction() as conn:
            cursor = conn.execute(
                "DELETE FROM active_transfers WHERE transfer_id = ?",
                (transfer_id,)
            )
            return cursor.rowcount > 0
    
    def mark_partial(
        self, 
        transfer_id: str, 
        partial_path: str, 
        partial_percent: float
    ) -> bool:
        
        now = datetime.now().isoformat()
        
        with self._transaction() as conn:
            cursor = conn.execute("""
                UPDATE active_transfers 
                SET status = 'partial', 
                    partial_path = ?, 
                    partial_percent = ?,
                    last_activity = ?
                WHERE transfer_id = ?
            """, (partial_path, partial_percent, now, transfer_id))
            return cursor.rowcount > 0
    
    def get_partial_transfers(self) -> List[Dict]:
        conn = self._get_connection()
        cursor = conn.execute(
            "SELECT * FROM active_transfers WHERE status = 'partial' ORDER BY started_at DESC"
        )
        return [dict(row) for row in cursor.fetchall()]
    
    def get_transfer(self, transfer_id: str) -> Optional[Dict]:
        conn = self._get_connection()
        cursor = conn.execute(
            "SELECT * FROM active_transfers WHERE transfer_id = ?",
            (transfer_id,)
        )
        row = cursor.fetchone()
        return dict(row) if row else None
    
    def get_transfer_by_record_id(self, record_id: str) -> Optional[Dict]:
        conn = self._get_connection()
        cursor = conn.execute(
            "SELECT * FROM active_transfers WHERE record_id = ?",
            (record_id,)
        )
        row = cursor.fetchone()
        return dict(row) if row else None
    
    def get_all_active(self) -> List[Dict]:
        conn = self._get_connection()
        cursor = conn.execute(
            "SELECT * FROM active_transfers WHERE status IN ('receiving', 'partial') ORDER BY started_at DESC"
        )
        return [dict(row) for row in cursor.fetchall()]
    
    def get_stale_transfers(self, timeout_minutes: int = 30) -> List[Dict]:
        from datetime import timedelta
        cutoff = (datetime.now() - timedelta(minutes=timeout_minutes)).isoformat()
        conn = self._get_connection()
        cursor = conn.execute("""
            SELECT * FROM active_transfers 
            WHERE last_activity < ? AND status = 'receiving'
            ORDER BY last_activity ASC
        """, (cutoff,))
        return [dict(row) for row in cursor.fetchall()]
    
    def cleanup_stale(self, timeout_minutes: int = 30) -> int:
        from datetime import timedelta
        cutoff = (datetime.now() - timedelta(minutes=timeout_minutes)).isoformat()
        
        with self._transaction() as conn:
            cursor = conn.execute("""
                DELETE FROM active_transfers 
                WHERE last_activity < ? AND status = 'receiving'
            """, (cutoff,))
            count = cursor.rowcount
            if count > 0:
                logger.info(f"Cleaned up {count} stale transfers")
            return count
    
    def cleanup_completed(self) -> int:
        with self._transaction() as conn:
            cursor = conn.execute(
                "DELETE FROM active_transfers WHERE status = 'completed'"
            )
            return cursor.rowcount
    
    def clear_all(self) -> int:
        with self._transaction() as conn:
            cursor = conn.execute("DELETE FROM active_transfers")
            return cursor.rowcount
    
    def get_stats(self) -> Dict[str, Any]:
        conn = self._get_connection()
        cursor = conn.execute(
            "SELECT COUNT(*) as count FROM active_transfers WHERE status = 'receiving'"
        )
        active_count = cursor.fetchone()['count']
        cursor = conn.execute("""
            SELECT 
                SUM(chunks_received) as received,
                SUM(chunk_total) as total
            FROM active_transfers 
            WHERE status = 'receiving'
        """)
        row = cursor.fetchone()
        chunks_received = row['received'] or 0
        chunks_total = row['total'] or 0
        
        return {
            'active_transfers': active_count,
            'total_chunks_received': chunks_received,
            'total_chunks_expected': chunks_total,
            'overall_progress': round((chunks_received / chunks_total * 100), 1) if chunks_total > 0 else 0
        }
    
    def to_dict(self) -> Dict[str, Dict]:
        transfers = self.get_all_active()
        result = {}
        for t in transfers:
            result[t['transfer_id']] = {
                'filename': t['filename'],
                'chunk_total': t['chunk_total'],
                'chunks_received': t['chunks_received'],
                'started_at': t['started_at'],
                'record_id': t['record_id']
            }
        return result
    
    def close(self):
        if hasattr(self._local, 'connection') and self._local.connection:
            try:
                self._local.connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            except Exception as e:
                logger.warning(f"WAL checkpoint failed: {e}")
            finally:
                self._local.connection.close()
                self._local.connection = None
    
    def checkpoint(self):
        conn = self._get_connection()
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        logger.info("WAL checkpoint completed")

_db_instance: Optional[TransferStateDB] = None

def get_transfer_state_db() -> TransferStateDB:
    global _db_instance
    if _db_instance is None:
        _db_instance = TransferStateDB()
    return _db_instance

def save_transfer_state(transfer_id: str, data: Dict):
    db = get_transfer_state_db()
    db.register_transfer(
        transfer_id=transfer_id,
        filename=data.get('filename', 'unknown'),
        chunk_total=data.get('chunk_total', 0),
        record_id=data.get('record_id'),
        hub_id=data.get('hub_id'),
        solo_id=data.get('solo_id'),
        metadata=data.get('metadata')
    )
    if 'chunks_received' in data:
        db.update_chunk_count(transfer_id, data['chunks_received'])

def get_all_transfer_states() -> Dict[str, Dict]:
    return get_transfer_state_db().to_dict()

def remove_transfer_state(transfer_id: str):
    get_transfer_state_db().complete_transfer(transfer_id)
