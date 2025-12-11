
const nextConfig = {
  reactStrictMode: false,
  distDir: ".next-build",
  

  // Rewrites for development - proxy font requests and API calls to FastAPI backend
  async rewrites() {
    // Get the backend URL from environment variable, default to Docker service name
    const backendUrl = process.env.BACKEND_URL || 'http://presenton-api:8000';
    
    return [
      {
        source: '/app_data/fonts/:path*',
        destination: 'http://localhost:8000/app_data/fonts/:path*',
      },
      // Proxy all /api/v1/ppt/* requests to Presenton FastAPI backend
      {
        source: '/api/v1/ppt/:path*',
        destination: `${backendUrl}/api/v1/ppt/:path*`,
      },
    ];
  },

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "pub-7c765f3726084c52bcd5d180d51f1255.r2.dev",
      },
      {
        protocol: "https",
        hostname: "pptgen-public.ap-south-1.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "pptgen-public.s3.ap-south-1.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "img.icons8.com",
      },
      {
        protocol: "https",
        hostname: "present-for-me.s3.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "yefhrkuqbjcblofdcpnr.supabase.co",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
      {
        protocol: "https",
        hostname: "unsplash.com",
      },
    ],
  },
  
};

export default nextConfig;
