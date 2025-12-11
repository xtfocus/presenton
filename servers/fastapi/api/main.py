import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from api.lifespan import app_lifespan
from api.middlewares import UserConfigEnvUpdateMiddleware
from api.v1.ppt.router import API_V1_PPT_ROUTER
from api.v1.webhook.router import API_V1_WEBHOOK_ROUTER
from api.v1.mock.router import API_V1_MOCK_ROUTER


app = FastAPI(lifespan=app_lifespan)


# Routers
app.include_router(API_V1_PPT_ROUTER)
app.include_router(API_V1_WEBHOOK_ROUTER)
app.include_router(API_V1_MOCK_ROUTER)

# Mount static files for images, exports, and fonts
# These are accessed via /app_data/images/, /app_data/exports/, etc.
app_data_dir = os.environ.get("APP_DATA_DIRECTORY", "/app_data")
images_dir = os.path.join(app_data_dir, "images")
exports_dir = os.path.join(app_data_dir, "exports")
fonts_dir = os.path.join(app_data_dir, "fonts")

# Create directories if they don't exist
os.makedirs(images_dir, exist_ok=True)
os.makedirs(exports_dir, exist_ok=True)
os.makedirs(fonts_dir, exist_ok=True)

# Mount static file directories
app.mount("/app_data/images", StaticFiles(directory=images_dir), name="app_images")
app.mount("/app_data/exports", StaticFiles(directory=exports_dir), name="exports")
app.mount("/app_data/fonts", StaticFiles(directory=fonts_dir), name="fonts")

# Mount built-in static files (icons, placeholder images)
# This serves /static/images/placeholder.jpg etc.
static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

# Middlewares
origins = ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(UserConfigEnvUpdateMiddleware)
