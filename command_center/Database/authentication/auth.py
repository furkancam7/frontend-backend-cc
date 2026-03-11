import os
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from .permission_models import TokenData, Token, UserLogin

def get_db():
    """Get singleton DatabaseManager instance from routes.utils."""
    from routes.utils import get_db as _get_db
    return _get_db()

ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
IS_PRODUCTION = ENVIRONMENT.lower() in ("production", "prod")
SECRET_KEY = os.getenv("JWT_SECRET_KEY")
if not SECRET_KEY:
    if IS_PRODUCTION:
        raise ValueError(
            "FATAL: JWT_SECRET_KEY environment variable is not set! "
            "Generate one with: python -c 'import secrets; print(secrets.token_hex(32))'"
        )
    else:
        import warnings
        SECRET_KEY = "DEV_ONLY_INSECURE_KEY_DO_NOT_USE_IN_PRODUCTION_12345"
        warnings.warn(
            "WARNING: Using insecure default JWT_SECRET_KEY. "
            "Set JWT_SECRET_KEY env var before deploying to production!",
            UserWarning
        )

ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "30"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("JWT_REFRESH_EXPIRE_DAYS", "7"))
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/login", auto_error=False)

ROLE_PERMISSIONS = {
    "admin": [
        "view_dashboard", 
        "edit_device", 
        "delete_device",
        "delete_record", 
        "manage_users", 
        "view_logs",
        "create_device",
        "update_crop",
        "delete_crop",
        "view_transfers",
        "manage_transfers"
    ],
    "editor": [
        "view_dashboard", 
        "edit_device", 
        "create_device",
        "update_crop",
        "view_transfers"
    ],
    "viewer": [
        "view_dashboard",
        "view_transfers"
    ]
}

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def get_user(username: str) -> Optional[Dict[str, Any]]:
    db = get_db()
    return db.get_user_by_username(username)

def authenticate_user(username: str, password: str) -> Optional[Dict[str, Any]]:
    user = get_user(username)
    if not user:
        return None
    if not verify_password(password, user["hashed_password"]):
        return None
    if not user.get("is_active", True):
        return None
    
    db = get_db()
    db.update_user_last_login(username)
    return user

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode.update({
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "type": "access"
    })
    
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "type": "refresh"
    })
    
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def refresh_access_token(refresh_token: str) -> Token:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired refresh token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        payload = jwt.decode(refresh_token, SECRET_KEY, algorithms=[ALGORITHM])
        token_type = payload.get("type")
        if token_type != "refresh":
            raise credentials_exception
        username: str = payload.get("sub")
        role: str = payload.get("role")
        if username is None:
            raise credentials_exception
        user = get_user(username)
        if user is None or not user.get("is_active", True):
            raise credentials_exception
        access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        new_access_token = create_access_token(
            data={
                "sub": user["username"],
                "role": user["role"],
                "email": user.get("email", "")
            },
            expires_delta=access_token_expires
        )
        
        return Token(
            access_token=new_access_token,
            token_type="bearer",
            user={
                "username": user["username"],
                "role": user["role"],
                "email": user.get("email", "")
            },
            expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60
        )
        
    except JWTError:
        raise credentials_exception

def decode_token(token: str) -> Optional[Dict[str, Any]]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None

async def get_current_user(token: str = Depends(oauth2_scheme)) -> TokenData:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    if token is None:
        raise credentials_exception
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        role: str = payload.get("role")
        if username is None:
            raise credentials_exception
        user = get_user(username)
        if user is None or not user.get("is_active", True):
            raise credentials_exception
        token_data = TokenData(username=username, role=role)
        
    except JWTError:
        raise credentials_exception
    
    return token_data

def check_permission(permission: str):
    def permission_checker(current_user: TokenData = Depends(get_current_user)):
        user_role = current_user.role
        
        if user_role not in ROLE_PERMISSIONS:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Unknown role: {user_role}"
            )
        
        user_permissions = ROLE_PERMISSIONS.get(user_role, [])
        
        if permission not in user_permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied. Required: {permission}"
            )
        
        return current_user
    
    return permission_checker

async def get_current_active_user(current_user: TokenData = Depends(get_current_user)) -> TokenData:
    return current_user

async def get_admin_user(current_user: TokenData = Depends(get_current_user)) -> TokenData:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return current_user

def login_for_access_token(username: str, password: str) -> Token:
    user = authenticate_user(username, password)
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={
            "sub": user["username"],
            "role": user["role"],
            "email": user.get("email", "")
        },
        expires_delta=access_token_expires
    )
    
    refresh_token = create_refresh_token(
        data={
            "sub": user["username"],
            "role": user["role"]
        }
    )
    
    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        user={
            "username": user["username"],
            "role": user["role"],
            "email": user.get("email", "")
        },
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60
    )

def create_user(
    username: str, 
    password: str, 
    role: str = "viewer", 
    email: str = ""
) -> Dict[str, Any]:

    db = get_db()
    if db.user_exists(username):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already exists"
        )
    
    if role not in ROLE_PERMISSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role. Must be one of: {list(ROLE_PERMISSIONS.keys())}"
        )
    
    password_hash = get_password_hash(password)
    created_user = db.create_user(username, password_hash, role, email)
    
    if not created_user:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create user"
        )
    
    return created_user

def update_user_password(username: str, new_password: str) -> bool:
    db = get_db()
    if not db.user_exists(username):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    password_hash = get_password_hash(new_password)
    success = db.update_user_password(username, password_hash)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update password"
        )
    
    return True

def deactivate_user(username: str) -> bool:
    db = get_db()
    if not db.user_exists(username):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    success = db.deactivate_user(username)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to deactivate user"
        )
    
    return True

def activate_user(username: str) -> bool:
    db = get_db()
    
    if not db.user_exists(username):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    success = db.activate_user(username)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to activate user"
        )
    
    return True

def list_users(include_inactive: bool = False) -> list:
    db = get_db()
    return db.list_users(include_inactive=include_inactive)

def delete_user_permanently(username: str) -> bool:
    db = get_db()
    if not db.user_exists(username):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    success = db.delete_user(username)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete user"
        )
    
    return True

def update_user(username: str, updates: Dict[str, Any]) -> bool:
    db = get_db()
    
    if not db.user_exists(username):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    if "role" in updates and updates["role"] not in ROLE_PERMISSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role. Must be one of: {list(ROLE_PERMISSIONS.keys())}"
        )
    
    success = db.update_user(username, updates)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update user"
        )
    
    return True
