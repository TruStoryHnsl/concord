// Static asset serving module.
//
// In debug mode, serves a minimal fallback page (the Vite dev server handles assets).
// In release mode, embeds the built frontend via rust-embed.

use axum::http::Uri;
#[cfg(not(debug_assertions))]
use axum::http::{header, StatusCode};
use axum::response::{Html, IntoResponse, Response};

/// Fallback HTML page served when the frontend build is unavailable.
const FALLBACK_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Concord Guest</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #1e1f22; color: #dbdee1;
           display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { text-align: center; max-width: 400px; padding: 2rem; }
    h1 { color: #a4a5ff; margin-bottom: .5rem; }
    p { color: #949ba4; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Concord</h1>
    <p>The guest web UI is available in release builds.<br/>
       In development, point your browser at the Vite dev server instead.</p>
  </div>
</body>
</html>"#;

#[cfg(not(debug_assertions))]
mod embedded {
    use rust_embed::Embed;

    #[derive(Embed)]
    #[folder = "../../frontend/dist/"]
    #[prefix = ""]
    pub struct FrontendAssets;
}

/// Axum handler that serves embedded static assets with correct MIME types
/// and falls back to `index.html` for SPA client-side routing.
pub async fn static_handler(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');

    #[cfg(not(debug_assertions))]
    {
        use embedded::FrontendAssets;

        // Try the exact path.
        if !path.is_empty() {
            if let Some(file) = FrontendAssets::get(path) {
                let mime = mime_guess::from_path(path).first_or_octet_stream();
                return (
                    [(header::CONTENT_TYPE, mime.as_ref().to_string())],
                    file.data.to_vec(),
                )
                    .into_response();
            }
        }

        // SPA fallback: serve index.html for any unmatched route.
        if let Some(file) = FrontendAssets::get("index.html") {
            return (
                [(header::CONTENT_TYPE, "text/html".to_string())],
                file.data.to_vec(),
            )
                .into_response();
        }
    }

    // Debug mode or missing dist — serve the fallback page.
    #[cfg(debug_assertions)]
    {
        let _ = path; // suppress unused warning
        return Html(FALLBACK_HTML).into_response();
    }

    #[cfg(not(debug_assertions))]
    {
        StatusCode::NOT_FOUND.into_response()
    }
}
