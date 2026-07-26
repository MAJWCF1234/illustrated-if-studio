import fs from "node:fs";
import path from "node:path";
import { copyDir, ensureDir, removeDir, slugify } from "../lib/fs-utils.mjs";
import { validateProject } from "../lib/validate.mjs";
import { zipDirectory } from "../lib/zip.mjs";
import { installWindowsScripts } from "./windows-scripts.mjs";

const CMAKE = `cmake_minimum_required(VERSION 3.16)
project(illustrated_if LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# CMake 4.x drops compatibility with sub-projects that request very old
# policy versions (raylib/glfw). This keeps FetchContent'd deps configuring.
if(NOT DEFINED CMAKE_POLICY_VERSION_MINIMUM)
  set(CMAKE_POLICY_VERSION_MINIMUM 3.5)
endif()

include(FetchContent)

FetchContent_Declare(
  json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG v3.11.3
  GIT_SHALLOW TRUE
)
set(JSON_BuildTests OFF CACHE INTERNAL "")
FetchContent_MakeAvailable(json)

# raylib — graphical player. Pinned tag; fetched + built from source so the
# package builds out of the box with no manual library install.
FetchContent_Declare(
  raylib
  GIT_REPOSITORY https://github.com/raysan5/raylib.git
  GIT_TAG 5.5
  GIT_SHALLOW TRUE
)
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(BUILD_GAMES OFF CACHE BOOL "" FORCE)
set(CUSTOMIZE_BUILD OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(raylib)

add_executable(illustrated_if
  src/main.cpp
  src/runtime.cpp
  src/saves.cpp
)
target_include_directories(illustrated_if PRIVATE include)
target_link_libraries(illustrated_if PRIVATE nlohmann_json::nlohmann_json raylib)

# MSVC: use a GUI subsystem entry point so no console window pops up for the
# graphical player, but still allow console output for the --script path.
if(MSVC)
  target_compile_definitions(illustrated_if PRIVATE _CRT_SECURE_NO_WARNINGS)
endif()

add_custom_command(TARGET illustrated_if POST_BUILD
  COMMAND \${CMAKE_COMMAND} -E copy_directory
          "\${CMAKE_SOURCE_DIR}/project"
          "$<TARGET_FILE_DIR:illustrated_if>/project"
)
`;

const CONDITIONS_HPP = `#pragma once
#include <nlohmann/json.hpp>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace ifs {

struct HistoryBeat {
  std::string id;
  std::string choice;
};

struct State {
  std::string playerName{"Traveler"};
  std::unordered_set<std::string> abilities;
  std::unordered_map<std::string, nlohmann::json> vars;
  std::vector<HistoryBeat> history;
  std::string currentScene;
};

inline bool eval_when(const nlohmann::json& when, const State& state) {
  if (when.is_null() || when.empty()) return true;
  if (when.contains("hasAbility")) {
    return state.abilities.count(when.at("hasAbility").get<std::string>()) > 0;
  }
  if (when.contains("not")) return !eval_when(when.at("not"), state);
  if (when.contains("all")) {
    for (const auto& w : when.at("all")) if (!eval_when(w, state)) return false;
    return true;
  }
  if (when.contains("any")) {
    for (const auto& w : when.at("any")) if (eval_when(w, state)) return true;
    return false;
  }
  if (when.contains("var")) {
    const auto key = when.at("var").get<std::string>();
    auto it = state.vars.find(key);
    if (it == state.vars.end()) return false;
    if (when.contains("eq")) return it->second == when.at("eq");
    if (when.contains("gte")) return it->second.get<double>() >= when.at("gte").get<double>();
    if (when.contains("lte")) return it->second.get<double>() <= when.at("lte").get<double>();
    if (when.contains("truthy")) return it->second.get<bool>() == when.at("truthy").get<bool>();
    return true;
  }
  return true;
}

}  // namespace ifs
`;

const SAVES_HPP = `#pragma once
#include "conditions.hpp"
#include <filesystem>
#include <optional>
#include <vector>

namespace ifs {

std::filesystem::path saves_dir(const std::filesystem::path& projectDir);
std::vector<nlohmann::json> list_slots(const std::filesystem::path& projectDir);
std::optional<nlohmann::json> read_slot(const std::filesystem::path& projectDir, int slot);
nlohmann::json write_slot(const std::filesystem::path& projectDir, int slot, const State& state,
                          const std::string& label = {});
void delete_slot(const std::filesystem::path& projectDir, int slot);
void apply_slot(State& state, const nlohmann::json& save);

}  // namespace ifs
`;

const SAVES_CPP = `#include "saves.hpp"
#include <ctime>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <stdexcept>

namespace ifs {
namespace {

std::string utc_now() {
  const auto t = std::time(nullptr);
  std::tm tm{};
#if defined(_WIN32)
  gmtime_s(&tm, &t);
#else
  gmtime_r(&t, &tm);
#endif
  std::ostringstream oss;
  oss << std::put_time(&tm, "%Y-%m-%dT%H:%M:%SZ");
  return oss.str();
}

}  // namespace

std::filesystem::path saves_dir(const std::filesystem::path& projectDir) {
  return projectDir / "saves";
}

std::vector<nlohmann::json> list_slots(const std::filesystem::path& projectDir) {
  const auto root = saves_dir(projectDir);
  std::filesystem::create_directories(root);
  std::vector<nlohmann::json> out;
  for (int i = 1; i <= 5; ++i) {
    const auto path = root / ("slot-" + std::to_string(i) + ".json");
    if (!std::filesystem::exists(path)) {
      out.push_back({{"slot", i}, {"empty", true}});
      continue;
    }
    try {
      std::ifstream in(path);
      nlohmann::json data;
      in >> data;
      out.push_back({
          {"slot", i},
          {"empty", false},
          {"playerName", data.value("playerName", "")},
          {"currentScene", data.value("currentScene", "")},
          {"updatedAt", data.value("updatedAt", nlohmann::json{})},
          {"label", data.value("label", nlohmann::json{})},
      });
    } catch (...) {
      out.push_back({{"slot", i}, {"empty", false}, {"corrupt", true}});
    }
  }
  return out;
}

std::optional<nlohmann::json> read_slot(const std::filesystem::path& projectDir, int slot) {
  if (slot < 1 || slot > 5) throw std::invalid_argument("slot must be 1-5");
  const auto path = saves_dir(projectDir) / ("slot-" + std::to_string(slot) + ".json");
  if (!std::filesystem::exists(path)) return std::nullopt;
  std::ifstream in(path);
  nlohmann::json data;
  in >> data;
  return data;
}

nlohmann::json write_slot(const std::filesystem::path& projectDir, int slot, const State& state,
                          const std::string& label) {
  if (slot < 1 || slot > 5) throw std::invalid_argument("slot must be 1-5");
  nlohmann::json abilities = nlohmann::json::array();
  for (const auto& a : state.abilities) abilities.push_back(a);
  nlohmann::json vars = nlohmann::json::object();
  for (const auto& [k, v] : state.vars) vars[k] = v;
  nlohmann::json history = nlohmann::json::array();
  for (const auto& h : state.history) {
    history.push_back({{"id", h.id}, {"choice", h.choice}});
  }
  nlohmann::json save = {
      {"formatVersion", 1},
      {"slot", slot},
      {"label", label.empty() ? ("Slot " + std::to_string(slot)) : label},
      {"playerName", state.playerName},
      {"currentScene", state.currentScene},
      {"abilities", abilities},
      {"vars", vars},
      {"history", history},
      {"updatedAt", utc_now()},
  };
  const auto root = saves_dir(projectDir);
  std::filesystem::create_directories(root);
  const auto path = root / ("slot-" + std::to_string(slot) + ".json");
  std::ofstream out(path);
  out << save.dump(2);
  return save;
}

void delete_slot(const std::filesystem::path& projectDir, int slot) {
  if (slot < 1 || slot > 5) throw std::invalid_argument("slot must be 1-5");
  const auto path = saves_dir(projectDir) / ("slot-" + std::to_string(slot) + ".json");
  if (std::filesystem::exists(path)) std::filesystem::remove(path);
}

void apply_slot(State& state, const nlohmann::json& save) {
  state.playerName = save.value("playerName", "");
  state.currentScene = save.value("currentScene", "start");
  state.abilities.clear();
  if (save.contains("abilities") && save.at("abilities").is_array()) {
    for (const auto& a : save.at("abilities")) state.abilities.insert(a.get<std::string>());
  }
  state.vars.clear();
  if (save.contains("vars") && save.at("vars").is_object()) {
    for (auto it = save.at("vars").begin(); it != save.at("vars").end(); ++it) {
      state.vars[it.key()] = it.value();
    }
  }
  state.history.clear();
  if (save.contains("history") && save.at("history").is_array()) {
    for (const auto& h : save.at("history")) {
      state.history.push_back({h.value("id", ""), h.value("choice", "")});
    }
  }
}

}  // namespace ifs
`;

const RUNTIME_HPP = `#pragma once
#include "conditions.hpp"
#include "saves.hpp"
#include <filesystem>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace ifs {

struct ChoiceView {
  std::string text;
  std::string next;
  nlohmann::json raw;
};

class Runtime {
 public:
  explicit Runtime(std::filesystem::path projectDir);

  const nlohmann::json& project() const { return project_; }
  const std::filesystem::path& projectDir() const { return projectDir_; }
  State& state() { return state_; }
  const State& state() const { return state_; }
  const nlohmann::json& scenes() const { return scenes_; }

  std::string interpolate(std::string text) const;
  const nlohmann::json& currentScene() const;
  void show(const std::string& sceneId, const std::string& choiceText = {}, bool recordHistory = true);
  std::vector<ChoiceView> visibleChoices() const;
  void choose(std::size_t index);
  void chooseByText(const std::string& textOrNext);
  bool canRollback() const;
  void rollback();
  /** Auto-advance one step if current scene was already read. Returns true if advanced. */
  bool skipIfRead();
  bool lastShowWasSeen() const { return lastShowWasSeen_; }
  void restart();
  std::vector<std::string> abilityList() const;

  nlohmann::json saveToSlot(int slot, const std::string& label = {});
  void loadFromSlot(int slot);
  void clearSaveSlot(int slot);
  std::vector<nlohmann::json> listSaveSlots() const;
  void exportSlotToFile(int slot, const std::string& outPath) const;
  nlohmann::json importSlotFromFile(int slot, const std::string& inPath);

 private:
  std::filesystem::path projectDir_;
  nlohmann::json project_;
  nlohmann::json scenes_;
  State state_;
  std::unordered_set<std::string> seenScenes_;
  std::unordered_map<std::string, std::string> lastChoiceByScene_;
  bool lastShowWasSeen_{false};
};

}  // namespace ifs
`;

const RUNTIME_CPP = `#include "runtime.hpp"
#include <algorithm>
#include <fstream>
#include <optional>
#include <stdexcept>

namespace ifs {
namespace {

nlohmann::json load_json(const std::filesystem::path& p) {
  std::ifstream in(p);
  if (!in) throw std::runtime_error("Cannot open " + p.string());
  nlohmann::json j;
  in >> j;
  return j;
}

}  // namespace

Runtime::Runtime(std::filesystem::path projectDir) : projectDir_(std::move(projectDir)) {
  project_ = load_json(projectDir_ / "project.json");
  const auto scenesRel = project_.at("story").at("scenes").get<std::string>();
  auto doc = load_json(projectDir_ / scenesRel);
  scenes_ = doc.contains("scenes") ? doc.at("scenes") : doc;
  show(project_.at("start").get<std::string>());
}

std::string Runtime::interpolate(std::string text) const {
  const auto& name = state_.playerName.empty() ? std::string("Traveler") : state_.playerName;
  const std::string token = "[NAME]";
  for (std::size_t pos = 0; (pos = text.find(token, pos)) != std::string::npos; ) {
    text.replace(pos, token.size(), name);
    pos += name.size();
  }
  return text;
}

const nlohmann::json& Runtime::currentScene() const {
  return scenes_.at(state_.currentScene);
}

void Runtime::show(const std::string& sceneId, const std::string& choiceText, bool recordHistory) {
  if (!scenes_.contains(sceneId)) throw std::runtime_error("Missing scene: " + sceneId);
  lastShowWasSeen_ = seenScenes_.count(sceneId) > 0;
  state_.currentScene = sceneId;
  if (recordHistory) state_.history.push_back({sceneId, choiceText});
  const auto& scene = scenes_.at(sceneId);
  if (scene.contains("unlockAbility") && !scene.at("unlockAbility").is_null()) {
    state_.abilities.insert(scene.at("unlockAbility").get<std::string>());
  }
  if (scene.contains("set") && scene.at("set").is_object()) {
    for (auto it = scene.at("set").begin(); it != scene.at("set").end(); ++it) {
      state_.vars[it.key()] = it.value();
    }
  }
  seenScenes_.insert(sceneId);
}

std::vector<ChoiceView> Runtime::visibleChoices() const {
  std::vector<ChoiceView> out;
  const auto& scene = currentScene();
  if (!scene.contains("choices")) return out;
  for (const auto& c : scene.at("choices")) {
    nlohmann::json when = c.contains("when") ? c.at("when") : nlohmann::json{};
    if (!eval_when(when, state_)) continue;
    ChoiceView v;
    v.text = c.value("text", "");
    v.next = c.value("next", "");
    v.raw = c;
    out.push_back(std::move(v));
  }
  return out;
}

void Runtime::choose(std::size_t index) {
  auto visible = visibleChoices();
  if (index >= visible.size()) throw std::out_of_range("choice index");
  const auto& c = visible[index];
  const std::string from = state_.currentScene;
  if (c.raw.contains("set") && c.raw.at("set").is_object()) {
    for (auto it = c.raw.at("set").begin(); it != c.raw.at("set").end(); ++it) {
      state_.vars[it.key()] = it.value();
    }
  }
  if (!c.text.empty()) lastChoiceByScene_[from] = c.text;
  show(c.next, c.text);
}

bool Runtime::canRollback() const { return state_.history.size() > 1; }

void Runtime::rollback() {
  if (!canRollback()) throw std::runtime_error("Nothing to roll back");
  state_.history.pop_back();
  const auto& prev = state_.history.back();
  show(prev.id, prev.choice, false);
}

bool Runtime::skipIfRead() {
  if (!lastShowWasSeen_) return false;
  const std::string sceneId = state_.currentScene;
  auto visible = visibleChoices();
  if (visible.empty()) return false;
  std::optional<std::size_t> pick;
  auto it = lastChoiceByScene_.find(sceneId);
  if (it != lastChoiceByScene_.end()) {
    for (std::size_t i = 0; i < visible.size(); ++i) {
      if (visible[i].text == it->second) {
        pick = i;
        break;
      }
    }
  }
  if (!pick && visible.size() == 1) pick = 0;
  if (!pick) return false;
  choose(*pick);
  return true;
}

void Runtime::chooseByText(const std::string& textOrNext) {
  auto visible = visibleChoices();
  for (std::size_t i = 0; i < visible.size(); ++i) {
    if (visible[i].text == textOrNext || visible[i].next == textOrNext) {
      choose(i);
      return;
    }
  }
  throw std::runtime_error("No visible choice: " + textOrNext);
}

void Runtime::restart() {
  bool keep = false;
  if (project_.contains("meta") && project_.at("meta").contains("keepAbilitiesOnRestart")) {
    keep = project_.at("meta").at("keepAbilitiesOnRestart").get<bool>();
  }
  auto abilities = state_.abilities;
  state_.vars.clear();
  state_.history.clear();
  if (!keep) state_.abilities.clear();
  else state_.abilities = std::move(abilities);
  show(project_.at("start").get<std::string>());
}

std::vector<std::string> Runtime::abilityList() const {
  std::vector<std::string> out(state_.abilities.begin(), state_.abilities.end());
  std::sort(out.begin(), out.end());
  return out;
}

nlohmann::json Runtime::saveToSlot(int slot, const std::string& label) {
  return write_slot(projectDir_, slot, state_, label);
}

void Runtime::loadFromSlot(int slot) {
  auto save = read_slot(projectDir_, slot);
  if (!save) throw std::runtime_error("Empty save slot " + std::to_string(slot));
  apply_slot(state_, *save);
  if (!scenes_.contains(state_.currentScene)) {
    throw std::runtime_error("Missing scene from save: " + state_.currentScene);
  }
}

void Runtime::clearSaveSlot(int slot) { delete_slot(projectDir_, slot); }

std::vector<nlohmann::json> Runtime::listSaveSlots() const { return list_slots(projectDir_); }

void Runtime::exportSlotToFile(int slot, const std::string& outPath) const {
  auto save = read_slot(projectDir_, slot);
  if (!save) throw std::runtime_error("Empty save slot " + std::to_string(slot));
  std::ofstream out(outPath);
  if (!out) throw std::runtime_error("Cannot write " + outPath);
  out << save->dump(2);
}

nlohmann::json Runtime::importSlotFromFile(int slot, const std::string& inPath) {
  std::ifstream in(inPath);
  if (!in) throw std::runtime_error("Cannot open " + inPath);
  nlohmann::json save;
  in >> save;
  if (!save.contains("currentScene") || !save.at("currentScene").is_string()) {
    throw std::runtime_error("Not a valid save file");
  }
  const auto sceneId = save.at("currentScene").get<std::string>();
  if (!scenes_.contains(sceneId)) {
    throw std::runtime_error("Save references unknown scene: " + sceneId);
  }
  State staged;
  apply_slot(staged, save);
  const auto label = save.value("label", std::string("Slot ") + std::to_string(slot));
  return write_slot(projectDir_, slot, staged, label);
}

}  // namespace ifs
`;

const MAIN_CPP = `#include "runtime.hpp"
#include "raylib.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <string>
#include <unordered_map>
#include <vector>

static std::filesystem::path find_project(const std::string& overridePath) {
  namespace fs = std::filesystem;
  if (!overridePath.empty()) {
    fs::path p = overridePath;
    if (fs::exists(p / "project.json")) return p;
    throw std::runtime_error("Project not found: " + overridePath);
  }
  const fs::path candidates[] = {
      fs::current_path() / "project",
      fs::current_path().parent_path() / "project",
  };
  for (const auto& p : candidates) {
    if (fs::exists(p / "project.json")) return p;
  }
  throw std::runtime_error("Could not find project/ next to the executable.");
}

static int run_script(ifs::Runtime& rt, const std::filesystem::path& scriptPath) {
  std::ifstream in(scriptPath);
  if (!in) throw std::runtime_error("Cannot open script " + scriptPath.string());
  nlohmann::json fix;
  in >> fix;
  const auto& steps = fix.at("steps");
  for (const auto& step : steps) {
    if (step.is_number_integer()) {
      rt.choose(static_cast<std::size_t>(step.get<int>()));
    } else {
      rt.chooseByText(step.get<std::string>());
    }
  }
  nlohmann::json abilities = nlohmann::json::array();
  for (const auto& a : rt.abilityList()) abilities.push_back(a);
  nlohmann::json result = {
      {"scene", rt.state().currentScene},
      {"abilities", abilities},
      {"historyLength", static_cast<int>(rt.state().history.size())},
  };
  std::cout << result.dump() << "\\n";
  if (fix.contains("expect")) {
    const auto& ex = fix.at("expect");
    if (ex.contains("scene") && ex.at("scene").get<std::string>() != rt.state().currentScene) {
      std::cerr << "Expected scene " << ex.at("scene") << " got " << rt.state().currentScene << "\\n";
      return 2;
    }
    if (ex.contains("abilities")) {
      for (const auto& a : ex.at("abilities")) {
        if (!rt.state().abilities.count(a.get<std::string>())) {
          std::cerr << "Missing ability: " << a.get<std::string>() << "\\n";
          return 2;
        }
      }
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Graphical player (raylib). Kept fully separate from the runtime/logic layer
// above so the headless --script parity path never touches windowing code.
// ---------------------------------------------------------------------------

namespace {

struct Theme {
  Color bg{5, 2, 8, 255};
  Color stage{10, 6, 18, 255};
  Color panel{18, 8, 28, 255};
  Color panelInner{26, 15, 46, 255};
  Color accent{168, 85, 247, 255};
  Color accentSoft{192, 132, 252, 255};
  Color text{243, 232, 255, 255};
  Color muted{167, 139, 186, 255};
  Color border{91, 45, 142, 255};
  Color speaker{233, 213, 255, 255};
  Color speakerBg{59, 7, 100, 255};
  Color choice{124, 58, 237, 255};
  Color choiceHover{147, 51, 234, 255};
};

Color hex_color(const std::string& hex, Color fallback) {
  if (hex.size() < 7 || hex[0] != '#') return fallback;
  auto conv = [&](int i) -> int { return std::stoi(hex.substr(i, 2), nullptr, 16); };
  try {
    return Color{(unsigned char)conv(1), (unsigned char)conv(3), (unsigned char)conv(5), 255};
  } catch (...) {
    return fallback;
  }
}

Theme load_theme(const ifs::Runtime& rt) {
  Theme t;
  try {
    std::string rel = rt.project().value("theme", std::string("theme/theme.json"));
    std::ifstream in(rt.projectDir() / rel);
    if (in) {
      nlohmann::json j;
      in >> j;
      if (j.contains("colors") && j.at("colors").is_object()) {
        const auto& c = j.at("colors");
        auto g = [&](const char* k, Color d) -> Color {
          return (c.contains(k) && c.at(k).is_string()) ? hex_color(c.at(k).get<std::string>(), d) : d;
        };
        t.bg = g("bg", t.bg);
        t.stage = g("stage", t.stage);
        t.panel = g("panel", t.panel);
        t.panelInner = g("panelInner", t.panelInner);
        t.accent = g("accent", t.accent);
        t.accentSoft = g("accentSoft", t.accentSoft);
        t.text = g("text", t.text);
        t.muted = g("muted", t.muted);
        t.border = g("border", t.border);
        t.speaker = g("speaker", t.speaker);
        t.speakerBg = g("speakerBg", t.speakerBg);
        t.choice = g("choice", t.choice);
        t.choiceHover = g("choiceHover", t.choiceHover);
      }
    }
  } catch (...) {
  }
  return t;
}

bool ends_with_svg(const std::string& file) {
  if (file.size() < 4) return false;
  std::string ext = file.substr(file.size() - 4);
  std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char ch) { return (char)std::tolower(ch); });
  return ext == ".svg";
}

// Texture cache. Missing / SVG / unreadable files are cached as an empty
// texture (id 0) so we fall back to a themed rectangle instead of retrying.
class AssetCache {
 public:
  explicit AssetCache(std::filesystem::path projectDir) : dir_(std::move(projectDir)) {}
  ~AssetCache() {
    for (auto& kv : cache_)
      if (kv.second.id != 0) UnloadTexture(kv.second);
  }

  Texture2D* get(const std::string& sub, const std::string& file) {
    if (file.empty() || ends_with_svg(file)) return nullptr;
    const std::string key = sub + "/" + file;
    auto it = cache_.find(key);
    if (it != cache_.end()) return it->second.id != 0 ? &it->second : nullptr;
    const auto path = dir_ / "assets" / sub / file;
    Texture2D tex{};
    if (std::filesystem::exists(path)) {
      tex = LoadTexture(path.string().c_str());
      if (tex.id != 0) SetTextureFilter(tex, TEXTURE_FILTER_BILINEAR);
    }
    cache_[key] = tex;
    return tex.id != 0 ? &cache_[key] : nullptr;
  }

 private:
  std::filesystem::path dir_;
  std::unordered_map<std::string, Texture2D> cache_;
};

std::string scene_string(const nlohmann::json& scene, const char* key) {
  if (scene.contains(key) && scene.at(key).is_string()) return scene.at(key).get<std::string>();
  return {};
}

std::vector<std::string> wrap_text(Font font, const std::string& text, float fontSize, float spacing,
                                   float maxWidth) {
  std::vector<std::string> lines;
  std::string line, word;
  auto width = [&](const std::string& s) { return MeasureTextEx(font, s.c_str(), fontSize, spacing).x; };
  auto flush_word = [&]() {
    if (word.empty()) return;
    const std::string cand = line.empty() ? word : line + " " + word;
    if (line.empty() || width(cand) <= maxWidth) {
      line = cand;
    } else {
      lines.push_back(line);
      line = word;
    }
    word.clear();
  };
  for (char ch : text) {
    if (ch == '\\n') {
      flush_word();
      lines.push_back(line);
      line.clear();
    } else if (ch == ' ') {
      flush_word();
    } else {
      word.push_back(ch);
    }
  }
  flush_word();
  lines.push_back(line);
  return lines;
}

Font load_ui_font() {
  // Load Basic Latin + Latin-1 + Latin Extended-A + common typographic
  // punctuation so accented locales and smart dashes/quotes render. raylib's
  // default font only carries ASCII, which turns "—" or "ñ" into "?".
  std::vector<int> cps;
  for (int c = 32; c <= 0x17F; ++c) cps.push_back(c);
  for (int c : {0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026})
    cps.push_back(c);
  const char* candidates[] = {
      "C:/Windows/Fonts/segoeui.ttf",
      "C:/Windows/Fonts/arial.ttf",
      "/System/Library/Fonts/SFNS.ttf",
      "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  };
  for (const char* c : candidates) {
    if (FileExists(c)) {
      Font f = LoadFontEx(c, 48, cps.data(), (int)cps.size());
      if (f.texture.id != 0) {
        SetTextureFilter(f.texture, TEXTURE_FILTER_BILINEAR);
        return f;
      }
    }
  }
  return GetFontDefault();
}

void draw_background(AssetCache& assets, const std::string& file, Rectangle stage, const Theme& t) {
  Texture2D* tex = assets.get("scene_images", file);
  if (tex) {
    const float scale = std::max(stage.width / tex->width, stage.height / tex->height);
    const float w = tex->width * scale;
    const float h = tex->height * scale;
    Rectangle src{0, 0, (float)tex->width, (float)tex->height};
    Rectangle dst{stage.x + (stage.width - w) / 2.0f, stage.y + (stage.height - h) / 2.0f, w, h};
    BeginScissorMode((int)stage.x, (int)stage.y, (int)stage.width, (int)stage.height);
    DrawTexturePro(*tex, src, dst, {0, 0}, 0.0f, WHITE);
    EndScissorMode();
  } else {
    // Themed fallback (missing art or SVG which raylib cannot decode).
    DrawRectangleGradientV((int)stage.x, (int)stage.y, (int)stage.width, (int)stage.height, t.stage,
                           t.panelInner);
  }
}

void draw_sprite(AssetCache& assets, const std::string& file, Rectangle stage, bool left) {
  Texture2D* tex = assets.get("characters", file);
  if (!tex) return;  // missing sprite -> hidden (matches HTML engine)
  const float h = stage.height * 0.92f;
  const float scale = h / tex->height;
  const float w = tex->width * scale;
  const float y = stage.y + stage.height - h;
  const float margin = stage.width * 0.02f;
  const float x = left ? stage.x + margin : stage.x + stage.width - w - margin;
  Rectangle src{0, 0, (float)tex->width, (float)tex->height};
  Rectangle dst{x, y, w, h};
  DrawTexturePro(*tex, src, dst, {0, 0}, 0.0f, WHITE);
}

int run_graphical(ifs::Runtime& rt) {
  const std::string title = rt.project().value("title", std::string("Illustrated IF"));
  const std::string author = rt.project().value("author", std::string(""));

  SetConfigFlags(FLAG_WINDOW_RESIZABLE | FLAG_MSAA_4X_HINT | FLAG_VSYNC_HINT);
  InitWindow(1100, 700, title.c_str());
  SetWindowMinSize(720, 520);
  SetExitKey(0);  // don't let ESC hard-close; we handle quit explicitly
  SetTargetFPS(60);

  const Theme theme = load_theme(rt);
  Font font = load_ui_font();
  AssetCache assets(rt.projectDir());

  enum class Screen { Gate, Scene };
  Screen screen = Screen::Gate;
  std::string name = rt.state().playerName.empty() ? std::string("Traveler") : rt.state().playerName;

  bool quit = false;
  while (!WindowShouldClose() && !quit) {
    const int W = GetScreenWidth();
    const int H = GetScreenHeight();
    const Vector2 mouse = GetMousePosition();
    const bool clicked = IsMouseButtonPressed(MOUSE_BUTTON_LEFT);

    BeginDrawing();
    ClearBackground(theme.bg);

    if (screen == Screen::Gate) {
      int ch = GetCharPressed();
      while (ch > 0) {
        if (ch >= 32 && ch <= 125 && name.size() < 24) name.push_back((char)ch);
        ch = GetCharPressed();
      }
      if (IsKeyPressed(KEY_BACKSPACE) && !name.empty()) name.pop_back();
      const bool begin = IsKeyPressed(KEY_ENTER);

      DrawRectangleGradientV(0, 0, W, H, theme.bg, theme.stage);
      const float tSize = 56.0f;
      Vector2 tw = MeasureTextEx(font, title.c_str(), tSize, 2.0f);
      DrawTextEx(font, title.c_str(), {(W - tw.x) / 2.0f, H * 0.22f}, tSize, 2.0f, theme.text);
      if (!author.empty()) {
        std::string by = "by " + author;
        Vector2 aw = MeasureTextEx(font, by.c_str(), 24.0f, 1.0f);
        DrawTextEx(font, by.c_str(), {(W - aw.x) / 2.0f, H * 0.22f + tSize + 6}, 24.0f, 1.0f, theme.muted);
      }

      const char* prompt = "Your name:";
      Vector2 pw = MeasureTextEx(font, prompt, 22.0f, 1.0f);
      const float boxW = 360.0f, boxH = 52.0f;
      const float boxX = (W - boxW) / 2.0f, boxY = H * 0.5f;
      DrawTextEx(font, prompt, {(W - pw.x) / 2.0f, boxY - 34}, 22.0f, 1.0f, theme.muted);
      DrawRectangleRounded({boxX, boxY, boxW, boxH}, 0.3f, 8, theme.panelInner);
      DrawRectangleRoundedLines({boxX, boxY, boxW, boxH}, 0.3f, 8, theme.accent);
      std::string shown = name;
      if (((int)(GetTime() * 2)) % 2 == 0) shown += "_";
      DrawTextEx(font, shown.c_str(), {boxX + 16, boxY + 13}, 26.0f, 1.0f, theme.text);

      const char* hint = "Press ENTER to begin";
      Vector2 hw = MeasureTextEx(font, hint, 20.0f, 1.0f);
      Rectangle btn{(W - 220.0f) / 2.0f, boxY + boxH + 28, 220.0f, 48.0f};
      const bool hover = CheckCollisionPointRec(mouse, btn);
      DrawRectangleRounded(btn, 0.4f, 8, hover ? theme.choiceHover : theme.choice);
      DrawTextEx(font, hint, {btn.x + (btn.width - hw.x) / 2.0f, btn.y + 13}, 20.0f, 1.0f, theme.text);

      if (begin || (hover && clicked)) {
        rt.state().playerName = name.empty() ? std::string("Traveler") : name;
        screen = Screen::Scene;
      }
      EndDrawing();
      continue;
    }

    // ---- Scene screen ----
    const auto& scene = rt.currentScene();
    auto choices = rt.visibleChoices();

    const Rectangle stage{0, 0, (float)W, H * 0.52f};
    draw_background(assets, scene_string(scene, "sceneImage"), stage, theme);
    draw_sprite(assets, scene_string(scene, "characterLeft"), stage, true);
    draw_sprite(assets, scene_string(scene, "characterRight"), stage, false);

    // Bottom panel
    const float panelY = stage.height;
    const float panelH = H - panelY;
    DrawRectangle(0, (int)panelY, W, (int)panelH, theme.panel);
    DrawRectangle(0, (int)panelY, W, 3, theme.accent);

    const float pad = 28.0f;
    float cursorY = panelY + pad;
    const float contentW = W - pad * 2.0f;

    const std::string speaker = rt.interpolate(scene_string(scene, "speaker"));
    if (!speaker.empty()) {
      Vector2 sw = MeasureTextEx(font, speaker.c_str(), 24.0f, 1.0f);
      DrawRectangleRounded({pad - 8, cursorY - 4, sw.x + 24, 34}, 0.5f, 8, theme.speakerBg);
      DrawTextEx(font, speaker.c_str(), {pad + 4, cursorY}, 24.0f, 1.0f, theme.speaker);
      cursorY += 44;
    }

    const std::string body = rt.interpolate(scene.value("text", std::string("")));
    const float bodySize = 22.0f;
    auto lines = wrap_text(font, body, bodySize, 1.0f, contentW);
    for (const auto& ln : lines) {
      DrawTextEx(font, ln.c_str(), {pad, cursorY}, bodySize, 1.0f, theme.text);
      cursorY += bodySize + 6;
    }
    cursorY += 12;

    // Choice buttons (mouse + number-key hotkeys)
    const float btnH = 44.0f;
    for (std::size_t i = 0; i < choices.size(); ++i) {
      Rectangle btn{pad, cursorY, contentW, btnH};
      const bool hover = CheckCollisionPointRec(mouse, btn);
      DrawRectangleRounded(btn, 0.25f, 8, hover ? theme.choiceHover : theme.choice);
      const std::string label = std::to_string(i + 1) + ".  " + rt.interpolate(choices[i].text);
      DrawTextEx(font, label.c_str(), {btn.x + 16, btn.y + 11}, 21.0f, 1.0f, theme.text);
      const bool key = (i < 9) && IsKeyPressed(KEY_ONE + (int)i);
      if ((hover && clicked) || key) {
        rt.choose(i);
        break;
      }
      cursorY += btnH + 10;
    }

    if (choices.empty()) {
      DrawTextEx(font, "The End.  Press R to play again.", {pad, cursorY}, 22.0f, 1.0f, theme.muted);
    }

    // Footer hint + global keys
    const char* footer = "[1-9] choose   [Backspace] back   [R] restart   [Esc] quit";
    DrawTextEx(font, footer, {pad, (float)H - 26}, 16.0f, 1.0f, theme.muted);

    if (IsKeyPressed(KEY_R)) rt.restart();
    if (IsKeyPressed(KEY_BACKSPACE) && rt.canRollback()) rt.rollback();
    if (IsKeyPressed(KEY_ESCAPE)) quit = true;

    EndDrawing();
  }

  if (font.texture.id != GetFontDefault().texture.id) UnloadFont(font);
  CloseWindow();
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  try {
    std::string projectPath;
    std::string scriptPath;
    std::string playerName;
    bool haveName = false;
    for (int i = 1; i < argc; ++i) {
      std::string a = argv[i];
      if ((a == "--project" || a == "-p") && i + 1 < argc) projectPath = argv[++i];
      else if ((a == "--script" || a == "-s") && i + 1 < argc) scriptPath = argv[++i];
      else if ((a == "--name" || a == "-n") && i + 1 < argc) { playerName = argv[++i]; haveName = true; }
      else if (a == "--help" || a == "-h") {
        std::cout << "Usage: illustrated_if [--project DIR] [--script fixture.json] [--name Name]\\n";
        return 0;
      }
    }
    ifs::Runtime rt(find_project(projectPath));
    if (haveName) rt.state().playerName = playerName;
    if (!scriptPath.empty()) {
      if (!haveName) rt.state().playerName = "Parity";
      return run_script(rt, scriptPath);  // headless: never opens a window
    }
    return run_graphical(rt);
  } catch (const std::exception& ex) {
    std::cerr << "Error: " << ex.what() << "\\n";
    return 1;
  }
}
`;

const README = (title, author) => `# ${title}

C++ source package for an **illustrated text-based RPG** — a real **graphical**
player built with [raylib](https://www.raylib.com/).

${author ? `by ${author}\n\n` : ""}
## Windows — just play (no coding needed)

1. Double-click **\`Play the Game\`**.
2. The first time, it may ask to install build tools (**Git**, **CMake**,
   **VS 2022 Build Tools**). That download can be **large** and take a while —
   you'll need the internet and a YES on the Windows permission prompt.
3. Then it configures, builds (Release), and launches the game.

The **first** build also downloads and compiles raylib + nlohmann/json from
source (a few more minutes). Later launches are fast.

If setup fails, open \`_emergency\` and run \`SETUP-ADMIN.bat\`, then try again.
Technical: \`PLAY.bat\` does the same with a visible console.

## Build (manual)

Requires CMake 3.16+ and a C++17 compiler. The first configure downloads
[nlohmann/json](https://github.com/nlohmann/json) and
[raylib](https://github.com/raysan5/raylib) via CMake FetchContent — no manual
library install required.

\`\`\`bash
cmake -S . -B build
cmake --build build --config Release
\`\`\`

## Run

\`\`\`bash
# Graphical player (opens a window)
build/Release/illustrated_if.exe

# Headless parity script (no window) — JSON fixture with steps + expect
build/Release/illustrated_if.exe --script path/to/fixture.json --name Parity
\`\`\`

In-game: click a choice or press its **number key**, **Backspace** = back,
**R** = restart, **Esc** = quit. On the title screen, type your name and press
**Enter**.

Scene art (\`sceneImage\`) and character sprites (\`characterLeft\` /
\`characterRight\`) are read from \`project/assets/\`. Missing sprites are hidden;
a missing or SVG background falls back to a themed panel (raylib can't decode
SVG). Colors come from \`project/theme/theme.json\`.

Saves write to \`project/saves/slot-N.json\` (same format as HTML/Python).

## Layout

- \`include/\` — \`conditions.hpp\`, \`runtime.hpp\`, \`saves.hpp\`
- \`src/\` — \`runtime.cpp\` + \`saves.cpp\` (logic) and \`main.cpp\` (raylib UI +
  headless \`--script\` path)
- \`project/\` — story JSON + assets + theme
`;

export function exportCpp({ studioRoot, projectDir, outRoot }) {
  const report = validateProject(projectDir);
  if (!report.ok) {
    return { ok: false, target: "cpp", errors: report.errors, warnings: report.warnings };
  }

  const project = report.project;
  const slug = slugify(project.id);
  const staging = path.join(outRoot, `${slug}-cpp`);
  const zipPath = path.join(outRoot, `${slug}-cpp.zip`);

  removeDir(staging);
  ensureDir(path.join(staging, "include"));
  ensureDir(path.join(staging, "src"));

  // Keep engine-cpp stub in sync with generated conditions (single source of truth)
  const stubDir = path.join(studioRoot, "engine-cpp", "include", "if");
  ensureDir(stubDir);
  fs.writeFileSync(path.join(stubDir, "conditions.hpp"), CONDITIONS_HPP);

  fs.writeFileSync(path.join(staging, "CMakeLists.txt"), CMAKE);
  fs.writeFileSync(path.join(staging, "include", "conditions.hpp"), CONDITIONS_HPP);
  fs.writeFileSync(path.join(staging, "include", "saves.hpp"), SAVES_HPP);
  fs.writeFileSync(path.join(staging, "include", "runtime.hpp"), RUNTIME_HPP);
  fs.writeFileSync(path.join(staging, "src", "runtime.cpp"), RUNTIME_CPP);
  fs.writeFileSync(path.join(staging, "src", "saves.cpp"), SAVES_CPP);
  fs.writeFileSync(path.join(staging, "src", "main.cpp"), MAIN_CPP);
  fs.writeFileSync(path.join(staging, "README.md"), README(project.title || slug, project.author || ""));
  fs.writeFileSync(
    path.join(staging, "README.txt"),
    `${project.title || slug}

How to play (Windows)
---------------------
1. Double-click:  Play the Game
2. First time may install build tools (LARGE download; can take a while) —
   click YES when Windows asks, stay online, then wait for the build.
3. The game window opens. Later plays are much faster.

If something goes wrong: open _emergency and read README.txt.
`
  );
  fs.writeFileSync(path.join(staging, "build.bat"), `@echo off\r\ncall "%~dp0PLAY.bat"\r\n`);

  copyDir(projectDir, path.join(staging, "project"), {
    filter: (entry) => entry.name !== "saves" && !entry.name.endsWith(".bak"),
  });
  installWindowsScripts(staging, "cpp");
  zipDirectory(staging, zipPath);

  return {
    ok: true,
    target: "cpp",
    folder: staging,
    zip: zipPath,
    warnings: report.warnings,
    notes: report.notes,
    sceneCount: report.sceneCount,
  };
}
