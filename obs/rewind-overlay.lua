--[[
  Rewind Overlay - OBS setup script

  Adds (or repairs) a "Rewind Overlay" browser source in the current scene,
  pointed at the local Rewind Overlay app. The desktop app must be running:
  it serves the overlay at http://127.0.0.1:19488/overlay and pushes live
  Retro Rewind data (VR, last-race gain/loss, global rank, tag) to it.

  Install: OBS -> Tools -> Scripts -> "+" -> pick this file.
  Then click "Add overlay to current scene".
]]

local obs = obslua

local SOURCE_NAME = "Rewind Overlay"
local DEFAULT_PORT = 19488

local settings_port = DEFAULT_PORT
local settings_width = 720
local settings_height = 220
local last_result = "Ready."

local function overlay_url()
  return string.format("http://127.0.0.1:%d/overlay?obs=1", settings_port)
end

local function apply_browser_settings(data)
  obs.obs_data_set_string(data, "url", overlay_url())
  obs.obs_data_set_int(data, "width", settings_width)
  obs.obs_data_set_int(data, "height", settings_height)
  obs.obs_data_set_int(data, "fps", 60)
  obs.obs_data_set_bool(data, "fps_custom", true)
  -- Keep the page alive while hidden so animations resume instantly.
  obs.obs_data_set_bool(data, "shutdown", false)
  obs.obs_data_set_bool(data, "restart_when_active", false)
  obs.obs_data_set_bool(data, "reroute_audio", false)
end

local function scene_contains_source(scene, source)
  local found = false
  local items = obs.obs_scene_enum_items(scene)
  if items then
    for _, item in ipairs(items) do
      if obs.obs_sceneitem_get_source(item) == source then
        found = true
      end
    end
    obs.sceneitem_list_release(items)
  end
  return found
end

local function add_overlay()
  local scene_source = obs.obs_frontend_get_current_scene()
  if not scene_source then
    last_result = "No active scene."
    return
  end
  local scene = obs.obs_scene_from_source(scene_source)

  local source = obs.obs_get_source_by_name(SOURCE_NAME)
  if source then
    -- Source already exists: refresh its settings and make sure it is in this scene.
    local data = obs.obs_data_create()
    apply_browser_settings(data)
    obs.obs_source_update(source, data)
    obs.obs_data_release(data)
    if not scene_contains_source(scene, source) then
      obs.obs_scene_add(scene, source)
      last_result = "Existing overlay source added to this scene."
    else
      last_result = "Overlay source repaired (URL/size refreshed)."
    end
    obs.obs_source_release(source)
  else
    local data = obs.obs_data_create()
    apply_browser_settings(data)
    local created = obs.obs_source_create("browser_source", SOURCE_NAME, data, nil)
    obs.obs_scene_add(scene, created)
    obs.obs_source_release(created)
    obs.obs_data_release(data)
    last_result = "Overlay added. Position it in the preview; size it in Rewind Overlay Studio."
  end

  obs.obs_source_release(scene_source)
end

-- OBS script API -------------------------------------------------------------

function script_description()
  return [[<h2>Rewind Overlay</h2>
<p>One-click setup for the Retro Rewind stream overlay
(VR, last-race gain/loss, global rank, player tag).</p>
<p><b>Start the Rewind Overlay app first</b>, then click the button below.
All styling (border effects, background, animations) is controlled live from
the app's Studio window - no OBS restart needed.</p>]]
end

function script_properties()
  local props = obs.obs_properties_create()
  obs.obs_properties_add_int(props, "port", "Overlay app port", 1024, 65535, 1)
  obs.obs_properties_add_int(props, "width", "Source width (px)", 280, 3840, 10)
  obs.obs_properties_add_int(props, "height", "Source height (px)", 80, 2160, 10)
  obs.obs_properties_add_button(props, "add_overlay", "Add overlay to current scene", function()
    add_overlay()
    return true -- refresh properties so the status line updates
  end)
  obs.obs_properties_add_text(props, "status", "Status", obs.OBS_TEXT_INFO)
  return props
end

function script_update(data)
  settings_port = obs.obs_data_get_int(data, "port")
  settings_width = obs.obs_data_get_int(data, "width")
  settings_height = obs.obs_data_get_int(data, "height")
end

function script_defaults(data)
  obs.obs_data_set_default_int(data, "port", DEFAULT_PORT)
  obs.obs_data_set_default_int(data, "width", 720)
  obs.obs_data_set_default_int(data, "height", 220)
  obs.obs_data_set_default_string(data, "status", last_result)
end
