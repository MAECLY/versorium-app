import { mount } from "svelte";
import App from "./App.svelte";
import "./styles.css";

export const app = mount(App, { target: document.getElementById("app")! });
