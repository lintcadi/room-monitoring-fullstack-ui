import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MatTabsModule } from '@angular/material/tabs';
import { DashboardTabs } from './shared/dashboard-tabs';

@Component({
  imports: [RouterOutlet, MatTabsModule, DashboardTabs],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {}
