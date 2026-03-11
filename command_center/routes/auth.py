from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from Database.authentication.auth import (
    get_current_active_user,
    get_admin_user,
    login_for_access_token,
    refresh_access_token,
    create_user,
    update_user_password,
    deactivate_user,
    list_users,
    verify_password,
    get_user
)
from Database.authentication.permission_models import (
    UserLogin,
    Token,
    TokenData,
    TokenRefresh,
    UserCreate,
    UserResponse,
    UserListResponse,
    UserPasswordChange
)

router = APIRouter(prefix="/api", tags=["Auth"])

@router.post("/login", response_model=Token)
async def login(form_data: UserLogin):
    return login_for_access_token(form_data.username, form_data.password)

@router.post("/login/form", response_model=Token)
async def login_form(form_data: OAuth2PasswordRequestForm = Depends()):
    return login_for_access_token(form_data.username, form_data.password)

@router.post("/refresh", response_model=Token)
async def refresh_token(token_data: TokenRefresh):
    return refresh_access_token(token_data.refresh_token)

@router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user: TokenData = Depends(get_current_active_user)):
    user = get_user(current_user.username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return UserResponse(
        username=user["username"],
        email=user.get("email"),
        role=user["role"],
        is_active=user.get("is_active", True),
        created_at=user.get("created_at")
    )

@router.post("/change-password")
async def change_password(
    password_data: UserPasswordChange,
    current_user: TokenData = Depends(get_current_active_user)
):
    user = get_user(current_user.username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if not verify_password(password_data.current_password, user["hashed_password"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    
    update_user_password(current_user.username, password_data.new_password)
    return {"message": "Password updated successfully"}

@router.get("/users", response_model=UserListResponse, tags=["User Management"])
async def get_users(current_user: TokenData = Depends(get_admin_user)):
    users = list_users()
    return UserListResponse(
        users=[UserResponse(**u) for u in users],
        total=len(users)
    )

@router.post("/users", response_model=UserResponse, tags=["User Management"])
async def create_new_user(
    user_data: UserCreate,
    current_user: TokenData = Depends(get_admin_user)
):
    new_user = create_user(
        username=user_data.username,
        password=user_data.password,
        role=user_data.role,
        email=user_data.email or ""
    )
    return UserResponse(**new_user)

@router.delete("/users/{username}", tags=["User Management"])
async def delete_user(
    username: str,
    current_user: TokenData = Depends(get_admin_user)
):
    if username == current_user.username:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")
    
    deactivate_user(username)
    return {"message": f"User {username} deactivated successfully"}
