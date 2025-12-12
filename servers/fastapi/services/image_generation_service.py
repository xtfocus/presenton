import asyncio
import os
import logging
from datetime import datetime
from typing import Optional
import aiohttp
from google import genai
from google.genai.types import GenerateContentConfig
from openai import AsyncOpenAI
from models.image_prompt import ImagePrompt
from models.sql.image_asset import ImageAsset
from utils.download_helpers import download_file
from utils.get_env import get_pexels_api_key_env
from utils.get_env import get_pixabay_api_key_env
from utils.image_provider import (
    is_image_generation_disabled,
    is_pixels_selected,
    is_pixabay_selected,
    is_gemini_flash_selected,
    is_dalle3_selected,
)
import uuid

logger = logging.getLogger(__name__)


class ImageGenerationService:
    def __init__(self, output_directory: str):
        self.output_directory = output_directory
        self.is_image_generation_disabled = is_image_generation_disabled()
        self.image_gen_func = self.get_image_gen_func()

    def get_image_gen_func(self):
        if self.is_image_generation_disabled:
            return None

        if is_pixabay_selected():
            return self.get_image_from_pixabay
        elif is_pixels_selected():
            return self.get_image_from_pexels
        elif is_gemini_flash_selected():
            return self.generate_image_google
        elif is_dalle3_selected():
            return self.generate_image_openai
        return None

    def is_stock_provider_selected(self):
        return is_pixels_selected() or is_pixabay_selected()

    async def generate_image(
        self, 
        prompt: ImagePrompt,
        stream_request_id: Optional[str] = None,
        slide_index: Optional[int] = None,
        image_index: Optional[int] = None,
    ) -> str | ImageAsset:
        """
        Generates an image based on the provided prompt.
        - If no image generation function is available, returns a placeholder image.
        - If the stock provider is selected, it uses the prompt directly,
        otherwise it uses the full image prompt with theme.
        - Output Directory is used for saving the generated image not the stock provider.
        """
        log_prefix = f"[STREAM-{stream_request_id}]" if stream_request_id else "[IMAGE]"
        context = f"slide {slide_index}, image {image_index}" if slide_index and image_index else "unknown context"
        
        logger.info(f"{log_prefix} Image generation requested for {context}")
        start_time = datetime.now()
        
        if self.is_image_generation_disabled:
            logger.warning(f"{log_prefix} Image generation disabled for {context}. Using placeholder.")
            return "/static/images/placeholder.jpg"

        if not self.image_gen_func:
            logger.warning(f"{log_prefix} No image generation function for {context}. Using placeholder.")
            return "/static/images/placeholder.jpg"

        image_prompt = prompt.get_image_prompt(
            with_theme=not self.is_stock_provider_selected()
        )
        logger.info(f"{log_prefix} Generating image for {context} - prompt: {image_prompt[:150]}...")

        image_path = None
        try:
            api_start_time = datetime.now()
            if self.is_stock_provider_selected():
                logger.info(f"{log_prefix} Calling stock provider API for {context}")
                image_path = await self.image_gen_func(image_prompt)
            else:
                logger.info(f"{log_prefix} Calling image generation API (Gemini/OpenAI) for {context}")
                image_path = await self.image_gen_func(
                    image_prompt, self.output_directory
                )
            api_duration = (datetime.now() - api_start_time).total_seconds()
            logger.info(f"{log_prefix} Image generation API call completed for {context} in {api_duration:.2f}s")
            
            if image_path:
                if image_path.startswith("http"):
                    total_duration = (datetime.now() - start_time).total_seconds()
                    logger.info(f"{log_prefix} Image generated successfully for {context} in {total_duration:.2f}s - URL: {image_path}")
                    return image_path
                elif os.path.exists(image_path):
                    total_duration = (datetime.now() - start_time).total_seconds()
                    logger.info(f"{log_prefix} Image generated successfully for {context} in {total_duration:.2f}s - Path: {image_path}")
                    return ImageAsset(
                        path=image_path,
                        is_uploaded=False,
                        extras={
                            "prompt": prompt.prompt,
                            "theme_prompt": prompt.theme_prompt,
                        },
                    )
            # Only raise if image_path was actually set
            if image_path:
                raise Exception(f"Image not found at {image_path}")
            else:
                raise Exception("Image generation function returned None or empty value")

        except Exception as e:
            total_duration = (datetime.now() - start_time).total_seconds()
            logger.error(f"{log_prefix} Image generation failed for {context} after {total_duration:.2f}s: {str(e)}", exc_info=True)
            logger.warning(f"{log_prefix} Returning placeholder image for {context} due to error")
            return "/static/images/placeholder.jpg"

    async def generate_image_openai(self, prompt: str, output_directory: str) -> str:
        client = AsyncOpenAI()
        result = await client.images.generate(
            model="dall-e-3",
            prompt=prompt,
            n=1,
            quality="standard",
            size="1024x1024",
        )
        image_url = result.data[0].url
        return await download_file(image_url, output_directory)

    async def generate_image_google(self, prompt: str, output_directory: str) -> str:
        logger.info(f"[GEMINI] Starting Gemini API call - prompt length: {len(prompt)}")
        gemini_start = datetime.now()
        
        client = genai.Client()
        try:
            response = await asyncio.to_thread(
                client.models.generate_content,
                model="gemini-2.5-flash-image-preview",
                contents=[prompt],
                config=GenerateContentConfig(response_modalities=["TEXT", "IMAGE"]),
            )
            gemini_duration = (datetime.now() - gemini_start).total_seconds()
            logger.info(f"[GEMINI] API call completed in {gemini_duration:.2f}s")

            image_path = None
            for part in response.candidates[0].content.parts:
                if part.text is not None:
                    logger.debug(f"[GEMINI] Received text response: {part.text[:100]}...")
                elif part.inline_data is not None:
                    image_path = os.path.join(output_directory, f"{uuid.uuid4()}.jpg")
                    with open(image_path, "wb") as f:
                        f.write(part.inline_data.data)
                    logger.info(f"[GEMINI] Image saved to: {image_path}")

            if not image_path:
                raise Exception("No image data received from Gemini API")

            total_duration = (datetime.now() - gemini_start).total_seconds()
            logger.info(f"[GEMINI] Image generation completed in {total_duration:.2f}s")
            return image_path
        except Exception as e:
            gemini_duration = (datetime.now() - gemini_start).total_seconds()
            logger.error(f"[GEMINI] API call failed after {gemini_duration:.2f}s: {str(e)}", exc_info=True)
            raise

    async def get_image_from_pexels(self, prompt: str) -> str:
        async with aiohttp.ClientSession(trust_env=True) as session:
            response = await session.get(
                f"https://api.pexels.com/v1/search?query={prompt}&per_page=1",
                headers={"Authorization": f"{get_pexels_api_key_env()}"},
            )
            data = await response.json()
            image_url = data["photos"][0]["src"]["large"]
            return image_url

    async def get_image_from_pixabay(self, prompt: str) -> str:
        async with aiohttp.ClientSession(trust_env=True) as session:
            response = await session.get(
                f"https://pixabay.com/api/?key={get_pixabay_api_key_env()}&q={prompt}&image_type=photo&per_page=3"
            )
            data = await response.json()
            image_url = data["hits"][0]["largeImageURL"]
            return image_url
