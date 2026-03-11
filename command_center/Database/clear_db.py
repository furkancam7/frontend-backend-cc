#!/usr/bin/env python3
import os
import sys
import psycopg2
from datetime import datetime

def _get_db_config():
    config = {
        'host': os.getenv('DB_HOST', 'localhost'),
        'port': os.getenv('DB_PORT', 5432),
        'database': os.getenv('DB_NAME', 'command_center'),
        'user': os.getenv('DB_USER', 'postgres'),
        'password': os.getenv('DB_PASSWORD', 'TurkAI2026_db')
    }
    if not config['password']:
        print("ERROR: DB_PASSWORD environment variable is not set!")
        print("Please set DB_PASSWORD before running this script.")
        sys.exit(1)
    return config

DB_CONFIG = _get_db_config()

def get_table_counts(cursor):
    cursor.execute("""
        SELECT schemaname, tablename 
        FROM pg_tables 
        WHERE schemaname = 'public'
    """)
    tables = cursor.fetchall()
    
    counts = {}
    for schema, table in tables:
        try:
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            counts[table] = cursor.fetchone()[0]
        except psycopg2.Error:
            counts[table] = "Error"
    return counts

def clear_all_data():
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()
        
        print("\n" + "="*60)
        print("COMMAND CENTER - DATABASE CLEANUP")
        print("="*60)
        print(f"Host: {DB_CONFIG['host']}:{DB_CONFIG['port']}")
        print(f"Database: {DB_CONFIG['database']}")
        print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("="*60)
        
        print("\n Current Record Counts:")
        counts = get_table_counts(cursor)
        for table, count in counts.items():
            print(f"   {table}: {count}")
        
        total = sum(c for c in counts.values() if isinstance(c, int))
        print(f"\n   Total: {total} records")
        
        if total == 0:
            print("\n Database is already empty!")
            conn.close()
            return
        
        print("\n" + "!"*60)
        print(" WARNING: This will DELETE ALL DATA!")
        print("!"*60)
        
        confirm = input("\nType 'DELETE' to confirm: ").strip()
        
        if confirm != 'DELETE':
            print("\n   Cancelled. No data was deleted.")
            conn.close()
            return
        
        print("\n  Deleting data...")
        
        namespaces = ['device', 'detection', 'crop', 'image', 'log', 'stats']
        
        for ns in namespaces:
            try:
                cursor.execute("DELETE FROM kv_store WHERE namespace = %s", (ns,))
                deleted = cursor.rowcount
                print(f"   namespace/{ns}: {deleted} rows deleted")
            except Exception as e:
                print(f"   namespace/{ns}: Error - {e}")
        
        try:
            cursor.execute("TRUNCATE TABLE kv_store RESTART IDENTITY")
            print("   kv_store: TRUNCATED")
        except Exception as e:
            try:
                cursor.execute("DELETE FROM kv_store")
                deleted = cursor.rowcount
                print(f"   kv_store (all): {deleted} rows deleted")
            except psycopg2.Error:
                pass
        
        conn.commit()
        
        print("\n After Cleanup:")
        counts = get_table_counts(cursor)
        for table, count in counts.items():
            print(f"   {table}: {count}")
        
        print("\n" + "="*60)
        print(" DATABASE CLEANUP COMPLETE")
        print("="*60)
        
        conn.close()
        
    except psycopg2.Error as e:
        print(f"\n Database Error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n Error: {e}")
        sys.exit(1)

def clear_specific_namespace(namespace):
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()
        
        print(f"\n Clearing namespace: {namespace}")
        
        cursor.execute(
            "DELETE FROM kv_store WHERE namespace = %s",
            (namespace,)
        )
        deleted = cursor.rowcount
        
        conn.commit()
        print(f" Deleted {deleted} records from '{namespace}' namespace")
        
        conn.close()
        
    except Exception as e:
        print(f" Error: {e}")
        sys.exit(1)

def clear_images_folder():
    images_dir = os.path.join(os.path.dirname(__file__), 'final_images')
    crops_dir = os.path.join(os.path.dirname(__file__), 'crops')
    
    deleted = 0
    
    for folder in [images_dir, crops_dir]:
        if os.path.exists(folder):
            for f in os.listdir(folder):
                filepath = os.path.join(folder, f)
                if os.path.isfile(filepath):
                    try:
                        os.remove(filepath)
                        deleted += 1
                    except OSError as e:
                        print(f"   Failed to delete {f}: {e}")
    
    print(f" Deleted {deleted} image files")

def main():
    if len(sys.argv) > 1:
        if sys.argv[1] == '--namespace' and len(sys.argv) > 2:
            clear_specific_namespace(sys.argv[2])
        elif sys.argv[1] == '--images':
            clear_images_folder()
        elif sys.argv[1] == '--all':
            clear_all_data()
            clear_images_folder()
        elif sys.argv[1] == '--help':
            print("""
Command Center Database Cleanup Script

Usage:
  python clear_db.py           # Clear all database records (with confirmation)
  python clear_db.py --all     # Clear database + image files
  python clear_db.py --images  # Clear only image files
  python clear_db.py --namespace <name>  # Clear specific namespace
                                          (detection, device, crop, image)
  python clear_db.py --help    # Show this help

Namespaces:
  - detection : Detection records
  - device    : Device info
  - crop      : Crop/detection details
  - image     : Image metadata
""")
        else:
            print(f"Unknown option: {sys.argv[1]}")
            print("Use --help for usage information")
    else:
        clear_all_data()

if __name__ == "__main__":
    main()
