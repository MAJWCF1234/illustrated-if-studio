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

include(FetchContent)
FetchContent_Declare(
  json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG v3.11.3
  GIT_SHALLOW TRUE
)
set(JSON_BuildTests OFF CACHE INTERNAL "")
FetchContent_MakeAvailable(json)

add_executable(illustrated_if
  src/main.cpp
  src/runtime.cpp
  src/saves.cpp
)
target_include_directories(illustrated_if PRIVATE include)
target_link_libraries(illustrated_if PRIVATE nlohmann_json::nlohmann_json)

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
#include <iostream>
#include <fstream>
#include <limits>
#include <string>
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

static void print_help_line() {
  std::cout << "  [1-9] choice  [B]ack  [K]skip-read  [A]bilities  [S]ave  [L]oad  [E]xport  [I]mport  [H]istory  [R]estart  [Q]uit\\n> ";
}

int run_interactive(ifs::Runtime& rt) {
  const auto title = rt.project().value("title", "Illustrated IF");
  const auto author = rt.project().value("author", "");
  std::cout << "========================================\\n";
  std::cout << title << "\\n";
  if (!author.empty()) std::cout << "by " << author << "\\n";
  std::cout << "Illustrated text-based RPG (console)\\n";
  std::cout << "========================================\\n\\n";
  std::cout << "Your name [" << rt.state().playerName << "]: ";
  {
    std::string name;
    std::getline(std::cin, name);
    if (!name.empty()) rt.state().playerName = name;
  }

  while (true) {
    const auto& scene = rt.currentScene();
    std::cout << "\\n----------------------------------------\\n";
    if (scene.contains("speaker") && scene.at("speaker").is_string() &&
        !scene.at("speaker").get<std::string>().empty()) {
      std::cout << rt.interpolate(scene.at("speaker").get<std::string>()) << "\\n\\n";
    }
    std::cout << rt.interpolate(scene.value("text", "")) << "\\n\\n";

    auto choices = rt.visibleChoices();
    if (choices.empty()) {
      std::cout << "(No more actions from here.)\\n";
    } else {
      for (std::size_t i = 0; i < choices.size(); ++i) {
        std::cout << "  [" << (i + 1) << "] " << choices[i].text << "\\n";
      }
    }
    print_help_line();
    std::string line;
    if (!std::getline(std::cin, line)) break;
    if (line.empty()) continue;
    char c0 = line[0];
    if (c0 == 'q' || c0 == 'Q') break;
    if (c0 == 'r' || c0 == 'R') {
      rt.restart();
      continue;
    }
    if (c0 == 'a' || c0 == 'A') {
      auto abs = rt.abilityList();
      std::cout << "Abilities:\\n";
      if (abs.empty()) std::cout << "  (none yet)\\n";
      for (const auto& a : abs) std::cout << "  - " << a << "\\n";
      continue;
    }
    if (c0 == 'b' || c0 == 'B') {
      try {
        rt.rollback();
        std::cout << "Rolled back.\\n";
      } catch (const std::exception& ex) {
        std::cout << ex.what() << "\\n";
      }
      continue;
    }
    if (c0 == 'k' || c0 == 'K') {
      int hops = 0;
      while (rt.skipIfRead()) ++hops;
      if (hops == 0) std::cout << "Skip stopped (unread or branching).\\n";
      else std::cout << "Skipped " << hops << " read scene(s).\\n";
      continue;
    }
    if (c0 == 'h' || c0 == 'H') {
      std::cout << "History (" << rt.state().history.size() << "):\\n";
      for (const auto& h : rt.state().history) {
        std::cout << "  " << h.id;
        if (!h.choice.empty()) std::cout << " ← " << h.choice;
        std::cout << "\\n";
      }
      continue;
    }
    if (c0 == 's' || c0 == 'S') {
      std::cout << "Save to slot 1-5: ";
      std::string s;
      std::getline(std::cin, s);
      std::cout << "Label (blank = default): ";
      std::string label;
      std::getline(std::cin, label);
      try {
        int slot = std::stoi(s);
        rt.saveToSlot(slot, label);
        std::cout << "Saved slot " << slot << "\\n";
      } catch (const std::exception& ex) {
        std::cout << "Save failed: " << ex.what() << "\\n";
      }
      continue;
    }
    if (c0 == 'e' || c0 == 'E') {
      std::cout << "Export slot 1-5: ";
      std::string s;
      std::getline(std::cin, s);
      std::cout << "To file path: ";
      std::string dest;
      std::getline(std::cin, dest);
      try {
        rt.exportSlotToFile(std::stoi(s), dest);
        std::cout << "Exported to " << dest << "\\n";
      } catch (const std::exception& ex) {
        std::cout << "Export failed: " << ex.what() << "\\n";
      }
      continue;
    }
    if (c0 == 'i' || c0 == 'I') {
      std::cout << "Import into slot 1-5: ";
      std::string s;
      std::getline(std::cin, s);
      std::cout << "From file path: ";
      std::string src;
      std::getline(std::cin, src);
      try {
        rt.importSlotFromFile(std::stoi(s), src);
        std::cout << "Imported into slot " << s << "\\n";
      } catch (const std::exception& ex) {
        std::cout << "Import failed: " << ex.what() << "\\n";
      }
      continue;
    }
    if (c0 == 'l' || c0 == 'L') {
      auto slots = rt.listSaveSlots();
      for (const auto& info : slots) {
        std::cout << "  Slot " << info.at("slot").get<int>() << ": ";
        if (info.value("empty", false)) std::cout << "empty";
        else if (info.value("corrupt", false)) std::cout << "corrupt";
        else
          std::cout << info.value("playerName", "") << " · " << info.value("currentScene", "");
        std::cout << "\\n";
      }
      std::cout << "Load slot 1-5: ";
      std::string s;
      std::getline(std::cin, s);
      try {
        int slot = std::stoi(s);
        rt.loadFromSlot(slot);
        std::cout << "Loaded slot " << slot << "\\n";
      } catch (const std::exception& ex) {
        std::cout << "Load failed: " << ex.what() << "\\n";
      }
      continue;
    }
    if (choices.empty()) continue;
    try {
      const int n = std::stoi(line);
      if (n >= 1 && static_cast<std::size_t>(n) <= choices.size()) {
        rt.choose(static_cast<std::size_t>(n - 1));
      }
    } catch (...) {
      std::cout << "Enter a number, A/S/L/H/R, or Q.\\n";
    }
  }
  return 0;
}

int main(int argc, char** argv) {
  try {
    std::string projectPath;
    std::string scriptPath;
    std::string playerName = "Parity";
    for (int i = 1; i < argc; ++i) {
      std::string a = argv[i];
      if ((a == "--project" || a == "-p") && i + 1 < argc) projectPath = argv[++i];
      else if ((a == "--script" || a == "-s") && i + 1 < argc) scriptPath = argv[++i];
      else if ((a == "--name" || a == "-n") && i + 1 < argc) playerName = argv[++i];
      else if (a == "--help" || a == "-h") {
        std::cout << "Usage: illustrated_if [--project DIR] [--script fixture.json] [--name Name]\\n";
        return 0;
      }
    }
    ifs::Runtime rt(find_project(projectPath));
    rt.state().playerName = playerName;
    if (!scriptPath.empty()) return run_script(rt, scriptPath);
    return run_interactive(rt);
  } catch (const std::exception& ex) {
    std::cerr << "Error: " << ex.what() << "\\n";
    return 1;
  }
}
`;

const README = (title, author) => `# ${title}

C++ source package for an **illustrated text-based RPG** (console player).

${author ? `by ${author}\n\n` : ""}
## Windows — first time

1. Double-click \`SETUP-ADMIN.bat\` (UAC) — installs **Git**, **CMake**, and **VS 2022 Build Tools (C++)** via winget if missing.
2. Double-click \`PLAY.bat\` — configures, builds (Release), and runs the console game.

## Build (manual)

Requires CMake 3.16+ and a C++17 compiler. First configure downloads [nlohmann/json](https://github.com/nlohmann/json).

\`\`\`bash
cmake -S . -B build
cmake --build build --config Release
\`\`\`

## Run

\`\`\`bash
# Interactive
build/Release/illustrated_if.exe

# Headless parity script (JSON fixture with steps + expect)
build/Release/illustrated_if.exe --script path/to/fixture.json --name Parity
\`\`\`

Commands in-game: numbered choices, **A**bilities, **S**ave / **L**oad slots 1–5, **H**istory, **R**estart, **Q**uit.

Saves write to \`project/saves/slot-N.json\` (same format as HTML/Python).

## Layout

- \`include/\` — \`conditions.hpp\`, \`runtime.hpp\`, \`saves.hpp\`
- \`src/\` — runtime + saves + console UI
- \`project/\` — story JSON + assets
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
