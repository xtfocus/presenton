import json
import os
import aiohttp
from typing import Literal
import uuid
from fastapi import HTTPException
from pathvalidate import sanitize_filename

from models.pptx_models import PptxPresentationModel
from models.presentation_and_path import PresentationAndPath
from services.pptx_presentation_creator import PptxPresentationCreator
from services.temp_file_service import TEMP_FILE_SERVICE
from utils.asset_directory_utils import get_exports_directory
import uuid


def get_nextjs_url() -> str:
    """Get Next.js service URL from environment variable or default to localhost"""
    return os.getenv("PRESENTON_NEXTJS_URL", "http://localhost:3000")


async def export_presentation(
    presentation_id: uuid.UUID, title: str, export_as: Literal["pptx", "pdf"]
) -> PresentationAndPath:
    nextjs_url = get_nextjs_url()
    
    if export_as == "pptx":

        # Get the converted PPTX model from the Next.js service
        # Set a long timeout for PPTX export (5 minutes) since Puppeteer rendering can take time
        timeout = aiohttp.ClientTimeout(total=300)  # 5 minutes
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(
                f"{nextjs_url}/api/presentation_to_pptx_model?id={presentation_id}"
            ) as response:
                response.raise_for_status()
                if response.status != 200:
                    error_text = await response.text()
                    print(f"Failed to get PPTX model: {error_text}")
                    raise HTTPException(
                        status_code=500,
                        detail="Failed to convert presentation to PPTX model",
                    )
                pptx_model_data = await response.json()

        # Create PPTX file using the converted model
        pptx_model = PptxPresentationModel(**pptx_model_data)
        temp_dir = TEMP_FILE_SERVICE.create_temp_dir()
        pptx_creator = PptxPresentationCreator(pptx_model, temp_dir)
        await pptx_creator.create_ppt()

        export_directory = get_exports_directory()
        pptx_path = os.path.join(
            export_directory,
            f"{sanitize_filename(title or str(uuid.uuid4()))}.pptx",
        )
        pptx_creator.save(pptx_path)

        return PresentationAndPath(
            presentation_id=presentation_id,
            path=pptx_path,
        )
    else:
        # Set a long timeout for PDF export (5 minutes) since Puppeteer rendering can take time
        timeout = aiohttp.ClientTimeout(total=300)  # 5 minutes
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(
                f"{nextjs_url}/api/export-as-pdf",
                json={
                    "id": str(presentation_id),
                    "title": sanitize_filename(title or str(uuid.uuid4())),
                },
            ) as response:
                response.raise_for_status()
                response_json = await response.json()

        return PresentationAndPath(
            presentation_id=presentation_id,
            path=response_json["path"],
        )
