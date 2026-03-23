import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * POST /api/brand-assets/upload
 * Uploads brand assets (logos, brand guidelines) to Supabase Storage
 * and creates tracking records in the brand_assets table.
 */
export async function POST(req: NextRequest) {
  const db = await createServerSupabaseClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const workspaceId = formData.get("workspaceId") as string;
  const assetType = formData.get("assetType") as string; // 'logo_primary', 'logo_dark', 'brand_doc'
  const file = formData.get("file") as File | null;

  if (!workspaceId || !assetType || !file) {
    return NextResponse.json(
      { error: "Missing workspaceId, assetType, or file" },
      { status: 400 }
    );
  }

  // Verify user is a member of this workspace
  const { data: membership } = await db
    .from("workspace_memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Not a workspace member" }, { status: 403 });
  }

  // Generate a unique storage path
  const ext = file.name.split(".").pop() ?? "bin";
  const timestamp = Date.now();
  const storagePath = `${workspaceId}/${assetType}/${timestamp}.${ext}`;

  // Upload to Supabase Storage
  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await db.storage
    .from("brand-assets")
    .upload(storagePath, arrayBuffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    console.error("[brand-upload] Storage upload error:", uploadError.message);
    return NextResponse.json(
      { error: "Upload failed: " + uploadError.message },
      { status: 500 }
    );
  }

  // Create brand_assets record
  const { data: asset, error: dbError } = await db
    .from("brand_assets")
    .insert({
      workspace_id: workspaceId,
      asset_type: assetType,
      file_name: file.name,
      storage_path: storagePath,
      mime_type: file.type,
      file_size_bytes: file.size,
      processing_status: "pending",
    })
    .select("id")
    .single();

  if (dbError) {
    console.error("[brand-upload] DB insert error:", dbError.message);
    return NextResponse.json(
      { error: "Failed to save asset record" },
      { status: 500 }
    );
  }

  return NextResponse.json({ id: asset.id, storagePath });
}
